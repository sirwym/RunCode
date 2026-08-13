import { useState } from "react";
import { Check, RotateCcw, Trash2 } from "lucide-react";
import { useI18n } from "../hooks/useI18n";
import type { RecoverableTab } from "../hooks/useTabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

interface RecoveryDialogProps {
  tabs: RecoverableTab[];
  onApply: (tabIds: string[]) => void;
  onDismiss: () => void;
}

function formatTime(unix: number): string {
  return new Date(unix).toLocaleString();
}

function RecoveryDialog({ tabs, onApply, onDismiss }: RecoveryDialogProps) {
  const t = useI18n((s) => s.t);
  // 默认全部勾选
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(tabs.map((tab) => tab.tabId)),
  );

  const toggle = (tabId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(tabId)) {
        next.delete(tabId);
      } else {
        next.add(tabId);
      }
      return next;
    });
  };

  const handleApply = () => {
    onApply(Array.from(selected));
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onDismiss()}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t("tabs.recovery.title")}</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-text-muted px-1 pb-2">
          {t("tabs.recovery.description")}
        </p>

        <ScrollArea className="max-h-[40vh] min-h-[80px] rounded-none border border-border">
          <ul className="p-2">
            {tabs.map((tab) => {
              const checked = selected.has(tab.tabId);
              return (
                <li key={tab.tabId}>
                  <button
                    className="recovery-item w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-bg-hover transition-colors"
                    onClick={() => toggle(tab.tabId)}
                  >
                    <span
                      className={`recovery-check inline-flex items-center justify-center w-4 h-4 border ${
                        checked
                          ? "bg-primary border-primary text-primary-foreground"
                          : "border-border bg-bg"
                      }`}
                    >
                      {checked && <Check size={12} strokeWidth={3} />}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium truncate">
                        {tab.fileName}
                      </span>
                      <span className="block text-xs text-text-muted">
                        {t("tabs.recovery.time")}: {formatTime(tab.timestamp)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </ScrollArea>

        <DialogFooter>
          <Button
            variant="compact"
            onClick={handleApply}
            disabled={selected.size === 0}
          >
            <RotateCcw size={12} />
            {t("tabs.recovery.restore")}
          </Button>
          <Button variant="outline" onClick={onDismiss}>
            <Trash2 size={12} />
            {t("tabs.recovery.dismiss")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default RecoveryDialog;
