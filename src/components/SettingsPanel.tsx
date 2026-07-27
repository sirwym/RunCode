import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettings } from "../hooks/useSettings";
import { useI18n, type Locale } from "../hooks/useI18n";
import type { AppSettings } from "../types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

type Section = "general" | "editor" | "language" | "shortcuts";

const CPP_STANDARDS = ["c++11", "c++14", "c++17", "c++20"];
const OPT_LEVELS = ["O0", "O1", "O2", "O3"];
const WARNING_LEVELS = [
  { value: "none", labelKey: "settings.warningsNone" },
  { value: "wall", label: "-Wall" },
  { value: "wall_extra", label: "-Wall -Wextra" },
];

// 平台检测：Windows/Linux 下快捷键显示 Ctrl，macOS 下显示 Cmd
const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

// 快捷键只读展示数据（与 lib.rs 菜单定义对齐）
export const SHORTCUTS: Array<{ category: "file" | "edit" | "find" | "view" | "app"; action: string; keys: string }> = [
  { category: "file", action: "menu.new", keys: "Cmd+N" },
  { category: "file", action: "menu.open", keys: "Cmd+O" },
  { category: "file", action: "menu.save", keys: "Cmd+S" },
  { category: "file", action: "menu.saveAs", keys: "Cmd+Shift+S" },
  { category: "file", action: "menu.close", keys: "Cmd+W" },
  { category: "file", action: "menu.closeAll", keys: "Cmd+Shift+W" },
  { category: "edit", action: "menu.format", keys: "Shift+Alt+F" },
  { category: "find", action: "menu.findFind", keys: "Cmd+F" },
  { category: "find", action: "menu.findNext", keys: "Cmd+G" },
  { category: "find", action: "menu.findPrev", keys: "Cmd+Shift+G" },
  { category: "find", action: "menu.replace", keys: "Cmd+Alt+F" },
  { category: "find", action: "menu.gotoLine", keys: "Ctrl+G" },
  { category: "view", action: "menu.fontInc", keys: "Cmd+=" },
  { category: "view", action: "menu.fontDec", keys: "Cmd+-" },
  { category: "view", action: "menu.fontReset", keys: "Cmd+0" },
  { category: "view", action: "menu.togglePanel", keys: "Cmd+\\" },
  { category: "app", action: "menu.settings", keys: "Cmd+," },
];

export const SHORTCUT_CATEGORY_KEY: Record<string, string> = {
  file: "settings.shortcutFile",
  edit: "settings.shortcutEdit",
  find: "settings.shortcutFind",
  view: "settings.shortcutView",
  app: "settings.shortcutApp",
};

function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const t = useI18n((s) => s.t);
  const settings = useSettings((s) => s.settings);
  const load = useSettings((s) => s.load);
  const saveSettings = useSettings((s) => s.save);
  const saving = useSettings((s) => s.saving);

  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [section, setSection] = useState<Section>("general");
  const [msg, setMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      void load();
      setMsg(null);
      setErrorMsg(null);
    }
  }, [open, load]);

  useEffect(() => {
    if (settings) setDraft(structuredClone(settings));
  }, [settings]);

  const updateGeneral = (k: keyof AppSettings["general"], v: string | number) =>
    setDraft((d) => (d ? { ...d, general: { ...d.general, [k]: v } } : d));
  const updateEditor = (
    k: keyof AppSettings["editor"],
    v: string | number | boolean
  ) => setDraft((d) => (d ? { ...d, editor: { ...d.editor, [k]: v } } : d));
  const updateRuntime = (k: keyof AppSettings["runtime"], v: number) =>
    setDraft((d) => (d ? { ...d, runtime: { ...d.runtime, [k]: v } } : d));
  const updateTest = (k: keyof AppSettings["test"], v: number) =>
    setDraft((d) => (d ? { ...d, test: { ...d.test, [k]: v } } : d));
  const updateCompiler = (k: keyof AppSettings["compiler"], v: string) =>
    setDraft((d) => (d ? { ...d, compiler: { ...d.compiler, [k]: v } } : d));

  const handleSave = async () => {
    if (!draft) return;
    setMsg(null);
    setErrorMsg(null);
    try {
      await saveSettings(draft);
      useI18n.getState().setLocale(draft.general.locale as Locale);
      setMsg(t("settings.saved"));
    } catch (e) {
      setErrorMsg(t("settings.saveFailed", { detail: String(e) }));
    }
  };

  const handleClearRecent = async () => {
    await invoke("clear_recent_files").catch(() => {});
    setMsg(t("recent.cleared", { title: t("recent.title") }));
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-[min(720px,calc(100vw-32px))] h-[min(600px,calc(100vh-32px))] max-w-none max-h-none p-0 flex flex-col">
        <DialogHeader className="px-6 pt-5 pb-3 border-b border-border flex-shrink-0">
          <DialogTitle>{t("settings.title")}</DialogTitle>
        </DialogHeader>

        {draft && (
          <div className="flex-1 min-h-0 flex flex-col px-6 py-4">
            <Tabs
              value={section}
              onValueChange={(v) => setSection(v as Section)}
              className="w-full flex-1 min-h-0 flex flex-col"
            >
              <TabsList className="grid w-full grid-cols-4 flex-shrink-0">
                <TabsTrigger value="general">
                  {t("settings.general")}
                </TabsTrigger>
                <TabsTrigger value="editor">{t("settings.editor")}</TabsTrigger>
                <TabsTrigger value="language">
                  {t("settings.languageSettings")}
                </TabsTrigger>
                <TabsTrigger value="shortcuts">
                  {t("settings.shortcuts")}
                </TabsTrigger>
              </TabsList>

              <div className="flex-1 min-h-0 overflow-y-auto pr-1 mt-4">
                {/* ========== 通用设置 Tab ========== */}
                <TabsContent
                  value="general"
                  className="space-y-3 mt-0"
                >
                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <Label htmlFor="set-locale">{t("settings.language")}</Label>
                    <Select
                      value={draft.general.locale}
                      onValueChange={(v) => updateGeneral("locale", v)}
                    >
                      <SelectTrigger id="set-locale">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(["zh", "en"] as Locale[]).map((l) => (
                          <SelectItem key={l} value={l}>
                            {t(`locale.${l}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <Label htmlFor="set-theme">{t("settings.appTheme")}</Label>
                    <Select
                      value={draft.general.theme}
                      onValueChange={(v) => updateGeneral("theme", v)}
                    >
                      <SelectTrigger id="set-theme">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="dark">
                          {t("settings.themeDark")}
                        </SelectItem>
                        <SelectItem value="light">
                          {t("settings.themeLight")}
                        </SelectItem>
                        <SelectItem value="system">
                          {t("settings.themeSystem")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <h4 className="settings-section-title pt-2">
                    {t("settings.dataManagement")}
                  </h4>
                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <span />
                    <Button
                      variant="compact"
                      onClick={() => void handleClearRecent()}
                    >
                      {t("recent.clear")}
                    </Button>
                  </div>
                </TabsContent>

                {/* ========== 编辑器设置 Tab ========== */}
                <TabsContent value="editor" className="space-y-3 mt-0">
                  <h4 className="settings-section-title">
                    {t("settings.editorFontSection")}
                  </h4>
                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <Label htmlFor="set-editor-font-size">
                      {t("settings.fontSize")}
                    </Label>
                    <Input
                      id="set-editor-font-size"
                      type="number"
                      min={8}
                      max={32}
                      className="w-32"
                      value={draft.editor.font_size}
                      onChange={(e) =>
                        updateEditor("font_size", Number(e.target.value))
                      }
                    />
                  </div>
                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <Label htmlFor="set-editor-theme">
                      {t("settings.editorTheme")}
                    </Label>
                    <Select
                      value={draft.editor.theme}
                      onValueChange={(v) => updateEditor("theme", v)}
                    >
                      <SelectTrigger id="set-editor-theme">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="vs-dark">
                          {t("settings.themeDark")}
                        </SelectItem>
                        <SelectItem value="vs">
                          {t("settings.themeLight")}
                        </SelectItem>
                        <SelectItem value="hc-black">
                          {t("settings.themeHighContrast")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <Label htmlFor="set-term-font-size">
                      {t("settings.terminalFontSize")}
                    </Label>
                    <Input
                      id="set-term-font-size"
                      type="number"
                      min={8}
                      max={32}
                      className="w-32"
                      value={draft.editor.terminal_font_size}
                      onChange={(e) =>
                        updateEditor(
                          "terminal_font_size",
                          Number(e.target.value)
                        )
                      }
                    />
                  </div>

                  <h4 className="settings-section-title pt-2">
                    {t("settings.editorBehaviorSection")}
                  </h4>
                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <Label htmlFor="set-indent-style">
                      {t("settings.indentStyle")}
                    </Label>
                    <Select
                      value={draft.editor.indent_style}
                      onValueChange={(v) => updateEditor("indent_style", v)}
                    >
                      <SelectTrigger id="set-indent-style">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="space">
                          {t("settings.indentSpace")}
                        </SelectItem>
                        <SelectItem value="tab">
                          {t("settings.indentTab")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <Label htmlFor="set-indent-size">
                      {t("settings.indentSize")}
                    </Label>
                    <Input
                      id="set-indent-size"
                      type="number"
                      min={2}
                      max={8}
                      className="w-32"
                      value={draft.editor.indent_size}
                      onChange={(e) =>
                        updateEditor("indent_size", Number(e.target.value))
                      }
                    />
                  </div>
                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <Label htmlFor="set-line-numbers">
                      {t("settings.lineNumbers")}
                    </Label>
                    <Select
                      value={draft.editor.line_numbers}
                      onValueChange={(v) => updateEditor("line_numbers", v)}
                    >
                      <SelectTrigger id="set-line-numbers">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="on">
                          {t("settings.lineNumbersOn")}
                        </SelectItem>
                        <SelectItem value="off">
                          {t("settings.lineNumbersOff")}
                        </SelectItem>
                        <SelectItem value="relative">
                          {t("settings.lineNumbersRelative")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <Label htmlFor="set-word-wrap">
                      {t("settings.wordWrap")}
                    </Label>
                    <Select
                      value={draft.editor.word_wrap}
                      onValueChange={(v) => updateEditor("word_wrap", v)}
                    >
                      <SelectTrigger id="set-word-wrap">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="on">
                          {t("settings.wordWrapOn")}
                        </SelectItem>
                        <SelectItem value="off">
                          {t("settings.wordWrapOff")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <h4 className="settings-section-title pt-2">
                    {t("settings.editorSmartSection")}
                  </h4>
                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <Label htmlFor="set-suggest">
                      {t("settings.enableSuggestions")}
                    </Label>
                    <Switch
                      id="set-suggest"
                      checked={draft.editor.enable_suggestions}
                      onCheckedChange={(v) =>
                        updateEditor("enable_suggestions", v)
                      }
                    />
                  </div>
                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <Label htmlFor="set-brackets">
                      {t("settings.autoClosingBrackets")}
                    </Label>
                    <Switch
                      id="set-brackets"
                      checked={draft.editor.auto_closing_brackets}
                      onCheckedChange={(v) =>
                        updateEditor("auto_closing_brackets", v)
                      }
                    />
                  </div>
                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <Label htmlFor="set-quotes">
                      {t("settings.autoClosingQuotes")}
                    </Label>
                    <Switch
                      id="set-quotes"
                      checked={draft.editor.auto_closing_quotes}
                      onCheckedChange={(v) =>
                        updateEditor("auto_closing_quotes", v)
                      }
                    />
                  </div>
                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <Label htmlFor="set-minimap">{t("settings.minimap")}</Label>
                    <Switch
                      id="set-minimap"
                      checked={draft.editor.minimap_enabled}
                      onCheckedChange={(v) =>
                        updateEditor("minimap_enabled", v)
                      }
                    />
                  </div>
                </TabsContent>

                {/* ========== 编程语言设置 Tab ========== */}
                <TabsContent value="language" className="space-y-3 mt-0">
                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <Label htmlFor="set-cur-lang">
                      {t("settings.currentLanguage")}
                    </Label>
                    <Select
                      value={draft.current_language}
                      onValueChange={(v) =>
                        setDraft((d) =>
                          d ? { ...d, current_language: v } : d
                        )
                      }
                    >
                      <SelectTrigger id="set-cur-lang">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cpp">C++</SelectItem>
                        <SelectItem value="python" disabled>
                          Python ({t("settings.comingSoon")})
                        </SelectItem>
                        <SelectItem value="java" disabled>
                          Java ({t("settings.comingSoon")})
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <h4 className="settings-section-title pt-2">
                    {t("settings.compiler")}
                  </h4>
                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <Label htmlFor="set-compiler-path">
                      {t("settings.compilerPath")}
                    </Label>
                    <Input
                      id="set-compiler-path"
                      type="text"
                      placeholder={t("settings.compilerPathHint")}
                      value={draft.compiler.compiler_path ?? ""}
                      onChange={(e) =>
                        updateCompiler("compiler_path", e.target.value)
                      }
                    />
                  </div>
                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <Label htmlFor="set-cpp-std">
                      {t("settings.cppStandard")}
                    </Label>
                    <Select
                      value={draft.compiler.cpp_standard}
                      onValueChange={(v) => updateCompiler("cpp_standard", v)}
                    >
                      <SelectTrigger id="set-cpp-std">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CPP_STANDARDS.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <Label htmlFor="set-opt-level">
                      {t("settings.optLevel")}
                    </Label>
                    <Select
                      value={draft.compiler.opt_level}
                      onValueChange={(v) => updateCompiler("opt_level", v)}
                    >
                      <SelectTrigger id="set-opt-level">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {OPT_LEVELS.map((s) => (
                          <SelectItem key={s} value={s}>
                            -{s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <Label htmlFor="set-warnings">
                      {t("settings.warnings")}
                    </Label>
                    <Select
                      value={draft.compiler.warnings}
                      onValueChange={(v) => updateCompiler("warnings", v)}
                    >
                      <SelectTrigger id="set-warnings">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {WARNING_LEVELS.map((w) => (
                          <SelectItem key={w.value} value={w.value}>
                            {w.labelKey ? t(w.labelKey) : w.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <Label htmlFor="set-extra-args">
                      {t("settings.extraArgs")}
                    </Label>
                    <Input
                      id="set-extra-args"
                      type="text"
                      placeholder="-DDEBUG -g"
                      value={draft.compiler.extra_args}
                      onChange={(e) =>
                        updateCompiler("extra_args", e.target.value)
                      }
                    />
                  </div>
                  <p className="settings-hint">{t("settings.extraArgsHint")}</p>

                  <h4 className="settings-section-title pt-2">
                    {t("settings.runtime")}
                  </h4>
                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <Label htmlFor="set-compile-timeout">
                      {t("settings.compileTimeout")}
                    </Label>
                    <Input
                      id="set-compile-timeout"
                      type="number"
                      min={1}
                      max={120}
                      className="w-32"
                      value={draft.runtime.compile_timeout_secs}
                      onChange={(e) =>
                        updateRuntime(
                          "compile_timeout_secs",
                          Number(e.target.value)
                        )
                      }
                    />
                  </div>
                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <Label htmlFor="set-run-timeout">
                      {t("settings.runTimeout")}
                    </Label>
                    <Input
                      id="set-run-timeout"
                      type="number"
                      min={1}
                      max={60}
                      className="w-32"
                      value={draft.runtime.run_timeout_secs}
                      onChange={(e) =>
                        updateRuntime(
                          "run_timeout_secs",
                          Number(e.target.value)
                        )
                      }
                    />
                  </div>
                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <Label htmlFor="set-cpu-secs">
                      {t("settings.cpuSecs")}
                    </Label>
                    <Input
                      id="set-cpu-secs"
                      type="number"
                      min={1}
                      max={60}
                      className="w-32"
                      value={draft.runtime.cpu_secs}
                      onChange={(e) =>
                        updateRuntime("cpu_secs", Number(e.target.value))
                      }
                    />
                  </div>

                  <h4 className="settings-section-title pt-2">
                    {t("settings.testSettings")}
                  </h4>
                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <Label htmlFor="set-fsize-mb">
                      {t("settings.fsizeMb")}
                    </Label>
                    <Input
                      id="set-fsize-mb"
                      type="number"
                      min={1}
                      max={500}
                      className="w-32"
                      value={draft.test.fsize_mb}
                      onChange={(e) =>
                        updateTest("fsize_mb", Number(e.target.value))
                      }
                    />
                  </div>
                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <Label htmlFor="set-test-time-limit">
                      {t("settings.testTimeLimit")}
                    </Label>
                    <Input
                      id="set-test-time-limit"
                      type="number"
                      min={100}
                      max={10000}
                      step={100}
                      className="w-32"
                      value={draft.test.test_time_limit_ms}
                      onChange={(e) =>
                        updateTest(
                          "test_time_limit_ms",
                          Number(e.target.value),
                        )
                      }
                    />
                  </div>
                  <p className="settings-hint">{t("settings.testTimeLimitHint")}</p>

                  <h4 className="settings-section-title pt-2">
                    {t("settings.codeTemplate")}
                  </h4>
                  <Textarea
                    className="font-mono text-xs"
                    rows={8}
                    value={draft.compiler.template}
                    onChange={(e) =>
                      updateCompiler("template", e.target.value)
                    }
                    spellCheck={false}
                  />
                </TabsContent>

                {/* ========== 快捷键只读展示 Tab ========== */}
                <TabsContent value="shortcuts" className="mt-0">
                  <div className="shortcuts-table">
                    <div className="shortcut-row shortcut-header">
                      <div className="shortcut-cell">
                        {t("settings.shortcutCategory")}
                      </div>
                      <div className="shortcut-cell">
                        {t("settings.shortcutAction")}
                      </div>
                      <div className="shortcut-cell shortcut-key">
                        {t("settings.shortcutKey")}
                      </div>
                    </div>
                    {SHORTCUTS.map((s, i) => (
                      <div className="shortcut-row" key={i}>
                        <div className="shortcut-cell">
                          {t(SHORTCUT_CATEGORY_KEY[s.category])}
                        </div>
                        <div className="shortcut-cell">{t(s.action)}</div>
                        <div className="shortcut-cell shortcut-key">
                          <kbd>{isMac ? s.keys : s.keys.replace(/\bCmd\b/g, "Ctrl")}</kbd>
                        </div>
                      </div>
                    ))}
                  </div>
                </TabsContent>
              </div>
            </Tabs>
          </div>
        )}

        {msg && <div className="settings-msg settings-msg-ok">{msg}</div>}
        {errorMsg && (
          <div className="settings-msg settings-msg-err">{errorMsg}</div>
        )}

        <DialogFooter className="px-6 py-3 border-t border-border flex-shrink-0">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t("settings.cancel")}
          </Button>
          <Button
            variant="default"
            onClick={() => void handleSave()}
            disabled={saving}
          >
            {saving ? "…" : t("settings.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default SettingsPanel;
