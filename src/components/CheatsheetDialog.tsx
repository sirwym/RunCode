import { useEffect, useMemo, useState } from "react";
import { Search, Copy, Check } from "lucide-react";
import { useI18n } from "../hooks/useI18n";
import { useSettings } from "../hooks/useSettings";
import { getEffectiveTheme, type SettingsTheme } from "../utils/theme";
import { useColorizedCode } from "../hooks/useColorizedCode";
import {
  CHEATSHEET_ENTRIES,
  searchCheatsheet,
  highlightText,
  CHEATSHEET_CATEGORIES,
  type CheatCategory,
  type CheatEntry,
} from "../data/cheatsheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

interface CheatsheetDialogProps {
  open: boolean;
  onClose: () => void;
}

// snippet 子组件：每个 snippet 独立调用 useColorizedCode（hook 不能在 map 回调里直接调用）
function Snippet({ code, themeKey }: { code: string; themeKey: string }) {
  const html = useColorizedCode(code, themeKey);
  return (
    <div className="cheatsheet-snippet">
      <pre
        className="cheatsheet-snippet-code"
        dangerouslySetInnerHTML={html ? { __html: html } : undefined}
      >
        {html ? null : code}
      </pre>
    </div>
  );
}

export default function CheatsheetDialog({
  open,
  onClose,
}: CheatsheetDialogProps) {
  const t = useI18n((s) => s.t);
  const settings = useSettings((s) => s.settings);
  const themePreview = useSettings((s) => s.themePreview);
  // themeKey：主题切换时触发 snippet 重新 colorize
  const themeKey = themePreview
    ? "custom"
    : getEffectiveTheme(settings?.general.theme as SettingsTheme | undefined);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CheatCategory | "all">("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // 每次打开重置状态（不保留上次搜索）
  useEffect(() => {
    if (open) {
      setQuery("");
      setCategory("all");
      setCopiedId(null);
    }
  }, [open]);

  const results = useMemo(
    () => searchCheatsheet(CHEATSHEET_ENTRIES, query, category),
    [query, category],
  );

  // 按 category 分组（保持 results 顺序，即分组内最高分顺序）
  const grouped = useMemo(() => {
    const map = new Map<CheatCategory, CheatEntry[]>();
    for (const r of results) {
      const arr = map.get(r.category) ?? [];
      arr.push(r);
      map.set(r.category, arr);
    }
    return map;
  }, [results]);

  // 分组渲染顺序：有 query 时按分组内最高分（results 首次出现顺序）排；
  // 空 query 时保持 CHEATSHEET_CATEGORIES 原顺序
  const groupOrder = useMemo(() => {
    const cats = CHEATSHEET_CATEGORIES.filter((c) => c.id !== "all");
    if (!query.trim()) return cats;
    const orderedIds: CheatCategory[] = [];
    for (const r of results) {
      if (!orderedIds.includes(r.category)) orderedIds.push(r.category);
    }
    return orderedIds.map((id) => cats.find((c) => c.id === id)!).filter(Boolean);
  }, [query, results]);

  const handleCopy = async (entry: CheatEntry) => {
    const text = entry.snippets.map((s) => s.code).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(entry.id);
      setTimeout(
        () => setCopiedId((cur) => (cur === entry.id ? null : cur)),
        1500,
      );
    } catch {
      // clipboard 不可用，静默失败
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl cheatsheet-dialog">
        <DialogHeader>
          <DialogTitle>{t("cheatsheet.title")}</DialogTitle>
        </DialogHeader>

        {/* 搜索框 */}
        <div className="cheatsheet-search">
          <Search size={14} className="cheatsheet-search-icon" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("cheatsheet.searchPlaceholder")}
            className="cheatsheet-search-input"
            autoFocus
          />
        </div>

        {/* 分类 chip 按钮 */}
        <div className="cheatsheet-categories">
          {CHEATSHEET_CATEGORIES.map((c) => (
            <button
              key={c.id}
              className={"cheatsheet-chip" + (category === c.id ? " active" : "")}
              onClick={() => setCategory(c.id)}
              type="button"
            >
              {t(c.labelKey)}
            </button>
          ))}
        </div>

        {/* 结果区：按分类分组 */}
        <ScrollArea className="cheatsheet-results">
          {results.length === 0 && (
            <div className="cheatsheet-empty">{t("cheatsheet.noResults")}</div>
          )}
          {groupOrder.map((c) => {
            const items = grouped.get(c.id as CheatCategory);
            if (!items || items.length === 0) return null;
            return (
              <section key={c.id} className="cheatsheet-group">
                <h3 className="cheatsheet-group-title">{t(c.labelKey)}</h3>
                {items.map((entry) => (
                  <article key={entry.id} className="cheatsheet-entry">
                    <div className="cheatsheet-entry-header">
                      <code
                        className="cheatsheet-entry-name"
                        dangerouslySetInnerHTML={{
                          __html: highlightText(entry.name, query),
                        }}
                      />
                      <span
                        className="cheatsheet-entry-title"
                        dangerouslySetInnerHTML={{
                          __html: highlightText(entry.title, query),
                        }}
                      />
                      <button
                        className="cheatsheet-copy"
                        onClick={() => void handleCopy(entry)}
                        title={t("cheatsheet.copy")}
                        type="button"
                      >
                        {copiedId === entry.id ? (
                          <Check size={12} />
                        ) : (
                          <Copy size={12} />
                        )}
                      </button>
                    </div>
                    <p
                      className="cheatsheet-entry-summary"
                      dangerouslySetInnerHTML={{
                        __html: highlightText(entry.summary, query),
                      }}
                    />
                    <div className="cheatsheet-snippets">
                      {entry.snippets.map((s, i) => (
                        <div key={i} className="cheatsheet-snippet">
                          <Snippet code={s.code} themeKey={themeKey} />
                          <span className="cheatsheet-snippet-comment">
                            {s.comment}
                          </span>
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </section>
            );
          })}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
