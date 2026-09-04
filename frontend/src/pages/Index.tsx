import { useState, useEffect } from "react";
import Header, { HistoryItem } from "@/components/Header";
import ImageUploader from "@/components/ImageUploader";
import PredictionResult, { Prediction } from "@/components/PredictionResult";
import { Brain } from "lucide-react";
import { toast } from "sonner";

const DEFAULT_API_BASE_URL = "https://zrn2003-skinsight-ai.hf.space";

const Index = () => {
  const [predictions, setPredictions] = useState<Prediction[] | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [currentImagePreview, setCurrentImagePreview] = useState<string | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("skinsight_history");
      if (stored) {
        setHistory(JSON.parse(stored));
      }
    } catch (e) {
      console.error("Failed to parse history from localStorage", e);
    }
  }, []);

  const saveHistoryItem = (item: HistoryItem) => {
    setHistory((prev) => {
      const updated = [item, ...prev.filter((h) => h.id !== item.id)].slice(0, 20);
      try {
        localStorage.setItem("skinsight_history", JSON.stringify(updated));
      } catch (e) {
        console.error("Failed to save history to localStorage", e);
      }
      return updated;
    });
  };

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem("skinsight_history");
    toast.info("History cleared.");
  };

  const normalizeConfidenceToPercent = (confidence: unknown): number => {
    const raw = typeof confidence === "number" ? confidence : Number(confidence);
    if (!Number.isFinite(raw)) return 0;
    const asPercent = raw <= 1 ? raw * 100 : raw;
    return Math.min(100, Math.max(0, asPercent));
  };

  const getConditionDetails = (label: string) => {
    if (label === "Melanoma") {
      return {
        description: "Malignant skin cancer arising from pigment-producing cells. Early detection is critical for treatment success.",
        severity: "high" as const,
        whatToDo: [
          "Schedule an appointment with a dermatologist immediately.",
          "Keep the area protected from sun exposure.",
          "Take a baseline photo to monitor any rapid changes."
        ],
        whatNotToDo: [
          "Do not scratch, pick, or attempt to remove the lesion.",
          "Avoid prolonged sun exposure and tanning beds.",
          "Do not apply over-the-counter hydrocortisone or home remedies."
        ],
        additionalInfo: "Melanoma is the most dangerous type of skin cancer but is often highly treatable when detected early."
      };
    } else if (label === "Tinea") {
      return {
        description: "Fungal infection causing circular, red, itchy patches on the skin. Treatable with antifungal medication.",
        severity: "medium" as const,
        whatToDo: [
          "Keep the affected area clean and dry.",
          "Use over-the-counter antifungal creams unless a doctor prescribes otherwise.",
          "Wash your hands thoroughly after touching the affected area.",
          "Wash clothes and towels in hot water."
        ],
        whatNotToDo: [
          "Avoid sharing towels, clothing, or personal items.",
          "Do not wear tight, non-breathable clothing over the area.",
          "Do not scratch the area to prevent secondary bacterial infections."
        ],
        additionalInfo: "Tinea, also known as ringworm, is highly contagious and can spread to other parts of your body or to other people and pets."
      };
    }

    return {
      description: "The uploaded image does not appear to contain skin tissue. Please upload a clear photo of the skin area you wish to analyze.",
      severity: "unknown" as const,
      whatToDo: [],
      whatNotToDo: [],
      additionalInfo: "Our AI system first checks to ensure the image contains human skin before attempting a diagnosis."
    };
  };

  const mapBackendResponse = (data: any): Prediction[] => {
    if (data.class === "Random Object") {
      const details = getConditionDetails("Random Object");
      return [{
        label: "Random Object",
        confidence: normalizeConfidenceToPercent(data.confidence),
        description: details.description,
        severity: details.severity,
        additionalInfo: details.additionalInfo
      }];
    }

    const probabilities = data.probabilities || {};
    const classes = Object.keys(probabilities);

    if (classes.length > 0) {
      // Sort classes by probability descending
      const sorted = classes.map((cls) => ({
        label: cls,
        prob: normalizeConfidenceToPercent(probabilities[cls])
      })).sort((a, b) => b.prob - a.prob);

      return sorted.map((item) => {
        const details = getConditionDetails(item.label);
        return {
          label: item.label,
          confidence: item.prob,
          description: details.description,
          severity: details.severity,
          whatToDo: details.whatToDo.length > 0 ? details.whatToDo : undefined,
          whatNotToDo: details.whatNotToDo.length > 0 ? details.whatNotToDo : undefined,
          additionalInfo: details.additionalInfo || undefined
        };
      });
    }

    // Fallback if no probabilities dict returned
    const primaryDetails = getConditionDetails(data.class);
    return [{
      label: data.class,
      confidence: normalizeConfidenceToPercent(data.confidence),
      description: primaryDetails.description,
      severity: primaryDetails.severity,
      whatToDo: primaryDetails.whatToDo.length > 0 ? primaryDetails.whatToDo : undefined,
      whatNotToDo: primaryDetails.whatNotToDo.length > 0 ? primaryDetails.whatNotToDo : undefined,
      additionalInfo: primaryDetails.additionalInfo || undefined
    }];
  };

  const handleImageUpload = async (file: File) => {
    setIsAnalyzing(true);
    setPredictions(null);

    // Create preview
    const reader = new FileReader();
    reader.onload = (e) => {
      setCurrentImagePreview(e.target?.result as string);
    };
    reader.readAsDataURL(file);

    const formData = new FormData();
    formData.append("file", file);

    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL;

    try {
      const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/predict`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Server Error: ${response.statusText}`);
      }

      const data = await response.json();
      if (data.error) {
        throw new Error(data.error);
      }

      const formattedPredictions = mapBackendResponse(data);
      setPredictions(formattedPredictions);

      // Save to history
      const historyItem: HistoryItem = {
        id: `scan-${Date.now()}`,
        timestamp: new Date().toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit"
        }),
        primaryLabel: formattedPredictions[0].label,
        confidence: formattedPredictions[0].confidence,
        predictions: formattedPredictions,
        imagePreview: currentImagePreview || undefined
      };
      saveHistoryItem(historyItem);

      toast.success("Analysis complete!");
    } catch (error: any) {
      console.error("Analysis failed:", error);
      toast.error(error.message || "Failed to analyze image. Please ensure backend is reachable.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSelectHistoryItem = (item: HistoryItem) => {
    setPredictions(item.predictions);
    if (item.imagePreview) {
      setCurrentImagePreview(item.imagePreview);
    }
    toast.info(`Loaded report for ${item.primaryLabel}`);
  };

  const handleReset = () => {
    setPredictions(null);
    setCurrentImagePreview(null);
  };

  return (
    <div className="min-h-screen bg-background">
      <Header
        history={history}
        onSelectHistoryItem={handleSelectHistoryItem}
        onClearHistory={clearHistory}
      />

      <main className="pt-24 pb-16 px-4">
        <div className="container mx-auto max-w-4xl">
          {/* Hero Section */}
          {!predictions && (
            <div className="text-center mb-12 animate-fade-in">
              <h2 className="font-heading font-bold text-4xl sm:text-5xl text-foreground mb-4">
                AI-Powered{" "}
                <span className="gradient-text">Skin Analysis</span>
              </h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                Upload a photo of your skin concern and get instant AI-powered predictions
                for conditions like melanoma, tinea, and more.
              </p>
            </div>
          )}

          {/* Main Content */}
          {predictions ? (
            <PredictionResult
              predictions={predictions}
              imagePreview={currentImagePreview}
              onReset={handleReset}
            />
          ) : (
            <ImageUploader onImageUpload={handleImageUpload} isAnalyzing={isAnalyzing} />
          )}

          {/* Features */}
          {!predictions && !isAnalyzing && (
            <div className="mt-16 animate-fade-in" style={{ animationDelay: "0.2s" }}>
              <div className="bg-card/50 rounded-2xl p-8 md:p-12 text-center hover-lift border border-border/50">
                <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-6">
                  <Brain className="w-8 h-8 text-primary" />
                </div>
                <h3 className="font-heading font-bold text-2xl text-foreground mb-4">Our Idea</h3>
                <p className="text-lg text-muted-foreground max-w-3xl mx-auto leading-relaxed">
                  SkinSight bridges the gap between patient uncertainty and professional diagnosis.
                  By leveraging state-of-the-art computer vision technology, we provide an accessible,
                  first-line screening tool for common skin conditions. Our two-stage AI pipeline
                  ensures robust analysis: first verifying the image contains skin, and then providing
                  a precise classification between critical conditions like Melanoma and treatable
                  issues like Tinea. We aim to empower users with information, encouraging timely
                  medical consultations and early intervention.
                </p>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default Index;
