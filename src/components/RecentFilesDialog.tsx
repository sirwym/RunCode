import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Trash2, FileText, X } from "lucide-react";
import { useI18n } from "../hooks/useI18n";
import type { RecentEntry } from "../types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

interface RecentFilesDialogProps {
  open: boolean;
  onClose: () => void;
  onOpenPath?: (path: string) => void;
}

function formatTime(unix: number): string {
  const d = new Date(unix * 1000);
  return d.toLocaleString();
}

function RecentFilesDialog({
  open,
  onClose,
  onOpenPath,
}: RecentFilesDialogProps) {
  const t = useI18n((s) => s.t);
  const [entries, setEntries] = useState<RecentEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    invoke<RecentEntry[]>("get_recent_files")
      .then((list) => {
        if (!cancelled) setEntries(list);
      })
      .catch((e) => {
        if (!cancelled) setError(typeof e === "string" ? e : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleOpen = (path: string) => {
    if (onOpenPath) {
      onOpenPath(path);
    }
    onClose();
  };

  const handleRemove = async (path: string) => {
    try {
      await invoke("remove_recent_file", { path });
      setEntries((prev) => prev.filter((e) => e.path !== path));
    } catch (e) {
      setError(typeof e === "string" ? e : String(e));
    }
  };

  const handleClear = async () => {
    try {
      await invoke("clear_recent_files");
      setEntries([]);
    } catch (e) {
      setError(typeof e === "string" ? e : String(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>{t("recent.title")}</DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[50vh] min-h-[120px] rounded-none border border-border">
          {loading && (
            <div className="recent-empty p-4 text-center text-text-muted">
              …
            </div>
          )}
          {!loading && entries.length === 0 && (
            <div className="recent-empty p-4 text-center text-text-muted">
              {t("recent.empty")}
            </div>
          )}
          {!loading && entries.length > 0 && (
            <ul className="recent-list p-2">
              {entries.map((e) => (
                <li key={e.path} className="recent-item">
                  <button
                    className="recent-item-main"
                    onClick={() => handleOpen(e.path)}
                    title={e.path}
                  >
                    <FileText size={14} />
                    <span className="recent-item-name">{e.name}</span>
                    <span className="recent-item-path">{e.path}</span>
                    <span className="recent-item-time">
                      {t("recent.openTime")}: {formatTime(e.opened_at)}
                    </span>
                  </button>
                  <button
                    className="recent-item-remove"
                    onClick={() => void handleRemove(e.path)}
                    title={t("recent.remove")}
                  >
                    <X size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {error && <div className="recent-error p-2 text-error">{error}</div>}
        </ScrollArea>

        <DialogFooter>
          <Button
            variant="compact"
            onClick={() => void handleClear()}
            disabled={entries.length === 0}
          >
            <Trash2 size={12} />
            {t("recent.clear")}
          </Button>
          <Button variant="outline" onClick={onClose}>
            {t("settings.cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default RecentFilesDialog;
