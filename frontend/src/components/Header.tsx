import { useState } from "react";
import { Activity, History, Trash2, X, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Prediction } from "./PredictionResult";
import { cn } from "@/lib/utils";

export interface HistoryItem {
  id: string;
  timestamp: string;
  primaryLabel: string;
  confidence: number;
  predictions: Prediction[];
  imagePreview?: string;
}

interface HeaderProps {
  history?: HistoryItem[];
  onSelectHistoryItem?: (item: HistoryItem) => void;
  onClearHistory?: () => void;
}

const Header = ({ history = [], onSelectHistoryItem, onClearHistory }: HeaderProps) => {
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-40 bg-background/80 backdrop-blur-md border-b border-border/50 transition-all duration-200">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Activity className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="font-heading font-bold text-xl text-foreground leading-tight">
                Skin<span className="text-primary">Sight</span>
              </h1>
              <p className="text-xs text-muted-foreground hidden sm:block">
                AI Skin Disease Analysis
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsHistoryOpen(true)}
              className="gap-2"
            >
              <History className="w-4 h-4" />
              <span className="hidden sm:inline">Scan History</span>
              {history.length > 0 && (
                <span className="bg-primary text-primary-foreground text-xs px-1.5 py-0.5 rounded-full font-semibold">
                  {history.length}
                </span>
              )}
            </Button>
          </div>
        </div>
      </header>

      {/* History Slide-over Drawer */}
      {isHistoryOpen && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex justify-end animate-fade-in">
          <div className="w-full max-w-md bg-card border-l border-border h-full flex flex-col shadow-elevated">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <History className="w-5 h-5 text-primary" />
                <h3 className="font-heading font-semibold text-foreground text-lg">
                  Analysis History
                </h3>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsHistoryOpen(false)}
              >
                <X className="w-5 h-5" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {history.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <p>No recent scans saved.</p>
                  <p className="text-xs mt-1">Uploaded image scans will appear here.</p>
                </div>
              ) : (
                history.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => {
                      onSelectHistoryItem?.(item);
                      setIsHistoryOpen(false);
                    }}
                    className="p-3 rounded-xl border border-border/60 bg-muted/30 hover:bg-muted/80 cursor-pointer transition-all flex items-center gap-3 hover-lift"
                  >
                    {item.imagePreview ? (
                      <img
                        src={item.imagePreview}
                        alt="Preview"
                        className="w-12 h-12 rounded-lg object-cover border border-border"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <Activity className="w-6 h-6 text-primary" />
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-semibold text-foreground text-sm truncate">
                          {item.primaryLabel}
                        </span>
                        <span className="text-xs font-medium text-primary">
                          {item.confidence.toFixed(1)}%
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">{item.timestamp}</p>
                    </div>

                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                  </div>
                ))
              )}
            </div>

            {history.length > 0 && (
              <div className="p-4 border-t border-border bg-card/50 flex justify-between items-center">
                <span className="text-xs text-muted-foreground">
                  {history.length} saved scans
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onClearHistory}
                  className="text-destructive hover:text-destructive hover:bg-destructive/10 gap-1.5"
                >
                  <Trash2 className="w-4 h-4" />
                  Clear History
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default Header;
