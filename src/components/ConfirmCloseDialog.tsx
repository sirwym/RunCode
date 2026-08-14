import { useI18n } from "../hooks/useI18n";
import type { ConfirmCloseCtx, ConfirmCloseDecision } from "../hooks/useTabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface ConfirmCloseDialogProps {
  open: boolean;
  mode: ConfirmCloseCtx["kind"];
  fileName?: string;
  count?: number;
  onResult: (r: ConfirmCloseDecision) => void;
}

function ConfirmCloseDialog({
  open,
  mode,
  fileName,
  count,
  onResult,
}: ConfirmCloseDialogProps) {
  const t = useI18n((s) => s.t);
  const message =
    mode === "single"
      ? t("tabs.closeConfirmMsg", { name: fileName ?? "" })
      : t("tabs.closeAllConfirmMsg", { count: count ?? 0 });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onResult("cancel")}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{t("tabs.closeConfirmTitle")}</DialogTitle>
          <DialogDescription>{message}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onResult("cancel")}>
            {t("tabs.cancel")}
          </Button>
          <Button variant="destructive" onClick={() => onResult("discard")}>
            {t("tabs.dontSave")}
          </Button>
          <Button variant="default" onClick={() => onResult("save")}>
            {t("tabs.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ConfirmCloseDialog;
