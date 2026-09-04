from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import numpy as np
from io import BytesIO
from PIL import Image
import torch
import torch.nn as nn
from torchvision import transforms, models
import cv2
import os

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- DEVICE CONFIG ---
device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
print(f"Using device: {device}")

# --- PREPROCESSING UTILS ---
class ImageProcessor:
    @staticmethod
    def hair_removal(image_np):
        # Convert RGB to Gray for morphology
        gray = cv2.cvtColor(image_np, cv2.COLOR_RGB2GRAY)
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (17, 17))
        blackhat = cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, kernel)
        _, mask = cv2.threshold(blackhat, 10, 255, cv2.THRESH_BINARY)
        # Inpaint variations on the original RGB image
        return cv2.inpaint(image_np, mask, 3, cv2.INPAINT_TELEA)

    @staticmethod
    def apply_clahe(image_np):
        lab = cv2.cvtColor(image_np, cv2.COLOR_RGB2LAB)
        l, a, b = cv2.split(lab)
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
        l = clahe.apply(l)
        return cv2.cvtColor(cv2.merge((l,a,b)), cv2.COLOR_LAB2RGB)

    @staticmethod
    def shades_of_grey(image_np, power=6):
        img_dtype = image_np.dtype
        r_norm = np.power(np.mean(np.power(image_np[:,:,0], power)), 1/power)
        g_norm = np.power(np.mean(np.power(image_np[:,:,1], power)), 1/power)
        b_norm = np.power(np.mean(np.power(image_np[:,:,2], power)), 1/power)
        norm_vec = np.array([r_norm, g_norm, b_norm])
        norm_vec = norm_vec / (np.sqrt(np.sum(np.square(norm_vec))) + 1e-6)
        uniform_illum = 1 / np.sqrt(3)
        manul_wb = np.diag([uniform_illum]*3) / (np.diag(norm_vec) + 1e-6)
        corrected = np.dot(image_np, manul_wb)
        return np.clip(corrected, 0, 255).astype(img_dtype)

# --- MODEL DEFINITIONS ---

class FilterModel(nn.Module):
    def __init__(self):
        super(FilterModel, self).__init__()
        self.model = models.resnet18(weights=None)
        self.model.fc = nn.Linear(self.model.fc.in_features, 2) 
    def forward(self, x):
        return self.model(x)

class FusionEnsemble(nn.Module):
    def __init__(self, num_classes=2):
        super(FusionEnsemble, self).__init__()
        resnet = models.resnet50(weights=None)
        self.resnet_features = nn.Sequential(*list(resnet.children())[:-1])
        
        self.inception = models.inception_v3(weights=None)
        self.inception.fc = nn.Identity()
        self.inception.aux_logits = False
        
        self.classifier = nn.Sequential(
            nn.Linear(4096, 1024),
            nn.ReLU(),
            nn.Dropout(0.6), # Matching training config (inference agnostic)
            nn.Linear(1024, num_classes)
        )
        
    def forward(self, x_res, x_inc):
        f_res = self.resnet_features(x_res)
        f_res = f_res.view(f_res.size(0), -1)
        
        f_inc = self.inception(x_inc)
        if hasattr(f_inc, 'logits'): f_inc = f_inc.logits
        
        combined = torch.cat((f_res, f_inc), dim=1)
        return self.classifier(combined)

# --- LOAD MODELS ---

FILTER_PATH = "models/filter_model.pth"
FUSION_PATH = "models/fusion_ensemble.pth"

filter_model = None
fusion_model = None

try:
    if os.path.exists(FILTER_PATH):
        filter_model = FilterModel().to(device)
        state_dict = torch.load(FILTER_PATH, map_location=device, weights_only=True)
        filter_model.load_state_dict(state_dict)
        filter_model.eval()
        print("✅ Filter Model loaded.")
    else:
        print(f"❌ Filter model not found at {FILTER_PATH}")

    if os.path.exists(FUSION_PATH):
        fusion_model = FusionEnsemble(num_classes=2).to(device)
        state_dict = torch.load(FUSION_PATH, map_location=device, weights_only=True)
        fusion_model.load_state_dict(state_dict)
        fusion_model.eval()
        print("✅ Fusion Model loaded.")
    else:
        print(f"❌ Fusion model not found at {FUSION_PATH}")

except Exception as e:
    print(f"❌ Error loading models: {e}")

# --- TRANSFORMS ---

norm = transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])

trans_224 = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    norm
])

trans_299 = transforms.Compose([
    transforms.Resize((299, 299)),
    transforms.ToTensor(),
    norm
])

# --- ENDPOINTS ---

@app.post("/predict")
async def predict(file: UploadFile = File(...)):
    if filter_model is None:
        return {"error": "Filter model is not loaded."}

    try:
        # 1. Read Image
        contents = await file.read()
        pil_image = Image.open(BytesIO(contents)).convert('RGB')
        img_np = np.array(pil_image)

        # 2. Preprocess for Filter Model (Hair + CLAHE + Grey)
        img_filter = ImageProcessor.hair_removal(img_np)
        img_filter = ImageProcessor.apply_clahe(img_filter)
        img_filter = ImageProcessor.shades_of_grey(img_filter) # Filter uses Grey
        
        # Transform for Filter
        input_filter = trans_224(Image.fromarray(img_filter)).unsqueeze(0).to(device)

        # 3. Stage 1: Filter Inference
        with torch.no_grad():
            filter_out = filter_model(input_filter)
            filter_probs = torch.softmax(filter_out, dim=1)
            filter_idx = torch.argmax(filter_probs).item()
            filter_conf = float(filter_probs[0][filter_idx])

        # Filter Classes: 0=Random Object, 1=Skin
        if filter_idx == 0:
            return {
                "class": "Random Object",
                "confidence": filter_conf,
                "stage": "Filter Data Rejection",
                "message": "Image rejected as non-skin."
            }

        # 4. Stage 2: Diagnosis (If Skin)
        if fusion_model is None:
            return {
                "class": "Skin (Model Not Loaded)",
                "confidence": filter_conf,
                "stage": "Filter Only",
                "message": "Fusion model unavailable for diagnosis."
            }

        # Preprocess for Fusion Model (Hair + CLAHE ONLY, No Grey)
        # We start from original img_np again
        img_fusion = ImageProcessor.hair_removal(img_np)
        img_fusion = ImageProcessor.apply_clahe(img_fusion)
        # Note: Fusion model training did NOT use shades_of_grey in ensemble.ipynb

        # Transform for Fusion (ResNet 224, Inception 299)
        input_res = trans_224(Image.fromarray(img_fusion)).unsqueeze(0).to(device)
        input_inc = trans_299(Image.fromarray(img_fusion)).unsqueeze(0).to(device)

        with torch.no_grad():
            fusion_out = fusion_model(input_res, input_inc)
            fusion_probs = torch.softmax(fusion_out, dim=1)
            fusion_idx = torch.argmax(fusion_probs).item()
            fusion_conf = float(fusion_probs[0][fusion_idx])

        # Fusion Classes: 0=Melanoma, 1=Tinea
        # NOTE: ensemble.ipynb: 0: Melanoma, 1: Tinea
        classes = ["Melanoma", "Tinea"]
        result_class = classes[fusion_idx]

        probabilities = {
            classes[i]: float(fusion_probs[0][i].item())
            for i in range(len(classes))
        }

        return {
            "class": result_class,
            "confidence": fusion_conf,
            "probabilities": probabilities,
            "stage": "Diagnosis",
            "filter_check": "Passed (Skin)",
            "filter_confidence": filter_conf
        }

    except Exception as e:
        return {"error": str(e)}

@app.get("/ping")
def ping():
    return {
        "status": "alive",
        "filter_loaded": filter_model is not None,
        "fusion_loaded": fusion_model is not None,
        "device": str(device)
    }

if __name__ == "__main__":
    import os
    # Allow configuration via environment variables
    # Use 0.0.0.0 to allow access from other machines on the network
    # Default to 7860 for Hugging Face Spaces, fallback to 8000 for local development
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", 7860))
    uvicorn.run(app, host=host, port=port)