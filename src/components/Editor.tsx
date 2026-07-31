import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type { editor as MonacoEditorNS, languages as MonacoLanguagesNS } from "monaco-editor";
import { invoke } from "@tauri-apps/api/core";
import type { EditorSettings, CompileError, CustomThemeColors } from "../types";
import { useTabs } from "../hooks/useTabs";
import { CPP_KEYWORDS_ALL, type KeywordKind } from "../monaco/cppKeywords";
import { CPP_MEMBERS, inferTypeAtDot, buildMemberSuggestions } from "../monaco/cppMembers";

// RunCode 品牌交互色（与 global.css 深色主题一致）
// Monaco colors 仅接受 HEX（3/4/6/8 位），rgba() 会被忽略并回退到默认色（红色）
export const RUNCODE_DARK_COLORS: Record<string, string> = {
  "editorCursor.foreground": "#6f91d5",
  "editor.selectionBackground": "#4A74C64D",
  "editor.inactiveSelectionBackground": "#4A74C626",
  "editor.selectionHighlightBackground": "#4A74C633",
  "editor.lineHighlightBackground": "#4A74C61A",
  "editor.lineHighlightBorder": "#00000000",
  "editor.focusBorder": "#6f91d5",
  "editorWidget.focusBorder": "#6f91d5",
  "editorSuggestWidget.focusBorder": "#6f91d5",
  "inputOption.activeBorder": "#6f91d5",
  "editorBracketMatch.border": "#6f91d5",
};

// RunCode 品牌交互色（与 global.css 浅色主题一致）
// Monaco colors 仅接受 HEX（3/4/6/8 位），rgba() 会被忽略并回退到默认色（红色）
export const RUNCODE_LIGHT_COLORS: Record<string, string> = {
  "editorCursor.foreground": "#365eaa",
  "editor.selectionBackground": "#365EAA40",
  "editor.inactiveSelectionBackground": "#365EAA1F",
  "editor.selectionHighlightBackground": "#365EAA2E",
  "editor.lineHighlightBackground": "#365EAA0F",
  "editor.lineHighlightBorder": "#00000000",
  "editor.focusBorder": "#365eaa",
  "editorWidget.focusBorder": "#365eaa",
  "editorSuggestWidget.focusBorder": "#365eaa",
  "inputOption.activeBorder": "#365eaa",
  "editorBracketMatch.border": "#365eaa",
};

// 渲染层 Monaco 主题映射：完全由 effectiveTheme（general.theme 派生）决定
// - dark   → runcode-dark（继承 vs-dark，仅覆盖光标/选区/当前行/焦点）
// - light  → runcode-light（继承 vs，仅覆盖上述色）
// - custom → runcode-custom（运行时 defineTheme，颜色取自 custom_theme.colors）
// settings.editor.theme 字段已废弃（保留 schema 但渲染层不读）；hc-black 不再暴露给用户
export function mapMonacoTheme(
  theme: "dark" | "light" | "custom" | undefined,
  customColors?: CustomThemeColors,
): string {
  if (theme === "light") return "runcode-light";
  if (theme === "custom" && customColors) return "runcode-custom";
  return "runcode-dark";
}

// 由 custom_theme.colors 构造 Monaco defineTheme 的 colors 字段
// editor.background 必须为透明色（#00000000），editorAlpha 只控制外层 .editor-container
// 透明度，不得在 Monaco 主题内重复应用（避免 0.92×0.92=0.9936 重复合成）
// 半透明选区/当前行色用 8 位 HEX（#RRGGBBAA）拼接，因 Monaco 不接受 rgba()
// 与 RUNCODE_DARK_COLORS / RUNCODE_LIGHT_COLORS 同构，仅颜色值替换
// baseMode 决定 Monaco base 主题（vs/vs-dark），禁止用 bg_terminal === "#ffffff" 推断
export function buildCustomMonacoColors(
  c: CustomThemeColors,
): Record<string, string> {
  const primaryHex = c.primary.toLowerCase();
  return {
    "editor.background": "#00000000",
    "editor.foreground": c.text,
    "editorCursor.foreground": c.primary,
    // 选区/当前行半透明：primary HEX + alpha（4D=30%, 26=15%, 33=20%, 1A=10%）
    "editor.selectionBackground": `${primaryHex}4D`,
    "editor.inactiveSelectionBackground": `${primaryHex}26`,
    "editor.selectionHighlightBackground": `${primaryHex}33`,
    "editor.lineHighlightBackground": `${primaryHex}1A`,
    "editor.lineHighlightBorder": "#00000000",
    "editor.focusBorder": c.primary,
    "editorWidget.focusBorder": c.primary,
    "editorSuggestWidget.focusBorder": c.primary,
    "inputOption.activeBorder": c.primary,
    "editorBracketMatch.border": c.primary,
  };
}

// 由 baseMode 决定 Monaco 继承主题：light → "vs"，dark → "vs-dark"
// 禁止用 bg_terminal === "#ffffff" 推断（浅色图可能提取出 #f3f7f8 等非纯白）
export function monacoBaseFromMode(baseMode: "light" | "dark" | undefined): "vs" | "vs-dark" {
  return baseMode === "light" ? "vs" : "vs-dark";
}

// 后端返回的符号结构
interface CodeSymbol {
  name: string;
  kind: string; // "function" / "variable" / "struct" / "macro"
  line: number;
}

// 暴露给父组件的命令接口
export interface EditorHandle {
  getCode: () => string;
  setValue: (s: string) => void;
  trigger: (action: string) => void;
  focus: () => void;
  switchModel: (tabId: string, content: string, language: string) => void;
  disposeModel: (tabId: string) => void;
  setCompileErrors: (errors: CompileError[]) => void;
  clearCompileErrors: () => void;
}

interface EditorPaneProps {
  onContentChange: (tabId: string, content: string) => void;
  /** 光标位置变化回调（用于 StatusBar 显示 Ln/Col） */
  onCursorPositionChange?: (line: number, col: number) => void;
  /** 编辑器设置（来自 settings.editor） */
  settings?: EditorSettings;
  /** 软件主题（effectiveTheme，由 general.theme 派生） */
  theme?: "dark" | "light" | "custom";
  /** 自定义图片主题颜色（仅 theme === "custom" 时使用） */
  customColors?: CustomThemeColors;
  /** 自定义主题 base_mode（仅 theme === "custom" 时使用，决定 Monaco 继承 vs/vs-dark） */
  baseMode?: "light" | "dark";
}

const EditorPane = forwardRef<EditorHandle, EditorPaneProps>(function EditorPane(
  { onContentChange, onCursorPositionChange, settings, theme, customColors, baseMode },
  ref
) {
  const editorRef = useRef<MonacoEditorNS.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof import("monaco-editor") | null>(null);
  const modelsRef = useRef<Map<string, MonacoEditorNS.ITextModel>>(new Map());
  const activeTabIdRef = useRef<string | null>(null);
  // L1+L2 补全 provider 的 disposable，组件卸载时清理
  const completionDisposablesRef = useRef<Array<{ dispose: () => void }>>([]);
  // 编译错误装饰 ID（deltaDecorations 增量更新）
  const decorationsRef = useRef<string[]>([]);
  // 同步最新 Monaco 主题给 onMount 闭包使用（避免闭包陈旧）
  const monacoThemeRef = useRef<string>("runcode-dark");
  // 用 ref 持有最新 onContentChange，避免 model.onDidChangeContent 闭包陈旧
  const onContentChangeRef = useRef(onContentChange);
  onContentChangeRef.current = onContentChange;
  // 用 ref 持有最新 onCursorPositionChange
  const onCursorPositionChangeRef = useRef(onCursorPositionChange);
  onCursorPositionChangeRef.current = onCursorPositionChange;
  // 用 ref 持有最新 customColors/baseMode，供 onMount 闭包读取最新值
  // 修复 Monaco 初始化竞态：无论 customColors 在挂载前还是挂载后到达，
  // onMount 都能用最新值定义 runcode-custom，避免占位深色主题永久存留
  // editorAlpha 不再经 Monaco 主题控制（editor.background 始终透明），无需 ref
  const customColorsRef = useRef(customColors);
  customColorsRef.current = customColors;
  const baseModeRef = useRef(baseMode);
  baseModeRef.current = baseMode;

  useImperativeHandle(
    ref,
    () => ({
      getCode: () => editorRef.current?.getValue() ?? "",
      setValue: (s: string) => {
        const editor = editorRef.current;
        if (!editor) return;
        const model = editor.getModel();
        if (model) {
          const range = model.getFullModelRange();
          model.applyEdits([{ range, text: s }]);
        } else {
          editor.setValue(s);
        }
      },
      trigger: (action: string) =>
        editorRef.current?.trigger("menu", action, null),
      focus: () => editorRef.current?.focus(),
      switchModel: (tabId, content, language) => {
        const editor = editorRef.current;
        const monaco = monacoRef.current;
        if (!editor || !monaco) return;

        activeTabIdRef.current = tabId;
        const uri = monaco.Uri.parse(`file:///tab/${tabId}`);
        let model = monaco.editor.getModel(uri);
        if (!model) {
          model = monaco.editor.createModel(content, language, uri);
          model.onDidChangeContent(() => {
            const id = activeTabIdRef.current;
            if (id) onContentChangeRef.current(id, model!.getValue());
          });
          modelsRef.current.set(tabId, model);
        }
        editor.setModel(model);
      },
      disposeModel: (tabId) => {
        const monaco = monacoRef.current;
        if (!monaco) return;
        const uri = monaco.Uri.parse(`file:///tab/${tabId}`);
        const model = monaco.editor.getModel(uri);
        if (model) {
          model.dispose();
          modelsRef.current.delete(tabId);
        }
      },
      setCompileErrors: (errors) => {
        const editor = editorRef.current;
        const monaco = monacoRef.current;
        if (!editor || !monaco || errors.length === 0) return;

        const decorations: MonacoEditorNS.IModelDeltaDecoration[] = errors.map((e) => ({
          range: new monaco.Range(e.line, 1, e.line, 1),
          options: {
            isWholeLine: true,
            className: "compile-error-line",
            hoverMessage: { value: `**${e.message}**` },
          },
        }));

        decorationsRef.current = editor.deltaDecorations(decorationsRef.current, decorations);
        // 跳转到第一个错误行
        editor.revealLineInCenter(errors[0].line);
      },
      clearCompileErrors: () => {
        const editor = editorRef.current;
        if (!editor) return;
        decorationsRef.current = editor.deltaDecorations(decorationsRef.current, []);
      },
    }),
    []
  );

  const handleMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // 定义 runcode-dark / runcode-light 继承主题
    // 保留 vs-dark / vs 原始语法高亮规则，仅覆盖光标/选区/当前行/焦点等交互色
    monaco.editor.defineTheme("runcode-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [],
      colors: RUNCODE_DARK_COLORS,
    });
    monaco.editor.defineTheme("runcode-light", {
      base: "vs",
      inherit: true,
      rules: [],
      colors: RUNCODE_LIGHT_COLORS,
    });
    // 定义 runcode-custom：用 ref 中的最新 customColors/baseMode
    // 修复 Monaco 初始化竞态：无论 customColors 在挂载前还是挂载后到达，
    // 首次 onMount 都用实际值定义主题，不让深色占位主题在重启路径永久存留
    const cc = customColorsRef.current;
    if (cc) {
      monaco.editor.defineTheme("runcode-custom", {
        base: monacoBaseFromMode(baseModeRef.current),
        inherit: true,
        rules: [],
        colors: buildCustomMonacoColors(cc),
      });
    } else {
      // customColors 未到达时用深色占位，后续 useEffect 覆盖
      monaco.editor.defineTheme("runcode-custom", {
        base: "vs-dark",
        inherit: true,
        rules: [],
        colors: RUNCODE_DARK_COLORS,
      });
    }

    // 修复 Bug 1：defineTheme 后立即应用，避免首次挂载回退到默认 vs（浅色）
    monaco.editor.setTheme(monacoThemeRef.current);

    // 光标位置变化回调（用于 StatusBar 显示 Ln/Col）
    editor.onDidChangeCursorPosition((e) => {
      onCursorPositionChangeRef.current?.(e.position.lineNumber, e.position.column);
    });

    // 14a.1 主动同步当前 active tab 的 model
    // 修复首次启动时 Monaco 显示空 model、无高亮、切回内容丢失的 bug
    const activeId = useTabs.getState().activeId;
    if (activeId) {
      const tab = useTabs.getState().tabs.find((t) => t.id === activeId);
      if (tab) {
        const uri = monaco.Uri.parse(`file:///tab/${tab.id}`);
        let model = monaco.editor.getModel(uri);
        if (!model) {
          model = monaco.editor.createModel(tab.content, tab.language, uri);
          model.onDidChangeContent(() => {
            const id = activeTabIdRef.current;
            if (id) onContentChangeRef.current(id, model!.getValue());
          });
          modelsRef.current.set(tab.id, model);
        }
        editor.setModel(model);
        activeTabIdRef.current = tab.id;
      }
    }

    // 代码补全 L0：C++ 关键词 + STL（纯文本补全，无 snippet 占位符）
    const keywordKindMap: Record<KeywordKind, MonacoLanguagesNS.CompletionItemKind> = {
      Keyword: monaco.languages.CompletionItemKind.Keyword,
      Class: monaco.languages.CompletionItemKind.Class,
      Function: monaco.languages.CompletionItemKind.Function,
      Variable: monaco.languages.CompletionItemKind.Variable,
      Constant: monaco.languages.CompletionItemKind.Constant,
      Module: monaco.languages.CompletionItemKind.Module,
    };
    const keywordDisposable = monaco.languages.registerCompletionItemProvider("cpp", {
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };
        return {
          suggestions: CPP_KEYWORDS_ALL.map((k) => ({
            label: k.label,
            kind: keywordKindMap[k.kind],
            insertText: k.label,
            detail: k.detail,
            sortText: "0_" + k.label,
            range,
          })),
        };
      },
    });
    completionDisposablesRef.current.push(keywordDisposable);

    // 代码补全 L2：成员方法补全（命中已知类型）+ 文件级符号补全（fallback）
    const symbolDisposable = monaco.languages.registerCompletionItemProvider("cpp", {
      triggerCharacters: ["."],
      provideCompletionItems: async (model, position) => {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };

        // 先尝试成员方法补全：基于 `.` 左侧变量声明推断类型
        // 命中已知类型时跳过后端 IPC，零延迟返回成员方法
        const code = model.getValue();
        const type = inferTypeAtDot(code, position.lineNumber, position.column);
        if (type && CPP_MEMBERS[type]) {
          return {
            suggestions: buildMemberSuggestions(
              CPP_MEMBERS[type],
              range,
              monaco.languages.CompletionItemKind.Method,
              monaco.languages.CompletionItemKind.Field,
              monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
            ),
          };
        }

        // 未命中类型推断，fallback 到文件级符号补全
        let symbols: CodeSymbol[] = [];
        try {
          symbols = await invoke<CodeSymbol[]>("extract_code_symbols", { code });
        } catch {
          return { suggestions: [] };
        }
        const kindMap: Record<string, MonacoLanguagesNS.CompletionItemKind> = {
          function: monaco.languages.CompletionItemKind.Function,
          variable: monaco.languages.CompletionItemKind.Variable,
          struct: monaco.languages.CompletionItemKind.Struct,
          macro: monaco.languages.CompletionItemKind.Constant,
        };
        return {
          suggestions: symbols.map((s) => ({
            label: s.name,
            kind: kindMap[s.kind] ?? monaco.languages.CompletionItemKind.Text,
            insertText: s.name,
            detail: `${s.kind} (line ${s.line})`,
            range,
          })),
        };
      },
    });
    completionDisposablesRef.current.push(symbolDisposable);
  }, []);

  // 计算 Monaco 主题：由 effectiveTheme（general.theme 派生）决定
  // settings.editor.theme 已废弃，渲染层不再读取
  const monacoTheme = mapMonacoTheme(theme, customColors);
  monacoThemeRef.current = monacoTheme;

  // customColors / baseMode 变化时，运行时 defineTheme("runcode-custom")
  // editor.background 始终为 #00000000（透明），editorAlpha 不再经 Monaco 主题控制
  // 用 JSON.stringify 作为依赖键，避免 customColors 对象引用变化导致无限循环
  // baseMode 决定 Monaco 继承主题（vs/vs-dark），禁止用 bg_terminal === "#ffffff" 推断
  const customColorsKey = customColors
    ? JSON.stringify(customColors) + "|" + (baseMode ?? "dark")
    : "";
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco || !customColors) return;
    monaco.editor.defineTheme("runcode-custom", {
      base: monacoBaseFromMode(baseMode),
      inherit: true,
      rules: [],
      colors: buildCustomMonacoColors(customColors),
    });
    // 若当前正是 custom 主题，立即应用（切换中实时生效）
    if (monacoThemeRef.current === "runcode-custom") {
      monaco.editor.setTheme("runcode-custom");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customColorsKey]);

  // settings 变化时实时更新 Monaco 选项
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !settings) return;
    editor.updateOptions({
      fontSize: settings.font_size,
      fontFamily:
        '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, "SF Mono", Menlo, Monaco, Consolas, monospace',
      tabSize: settings.indent_size,
      insertSpaces: settings.indent_style !== "tab",
      lineNumbers: settings.line_numbers as "on" | "off" | "relative",
      wordWrap: settings.word_wrap as "on" | "off",
      minimap: { enabled: settings.minimap_enabled },
      quickSuggestions: settings.enable_suggestions,
      suggestOnTriggerCharacters: settings.enable_suggestions,
      autoClosingBrackets: settings.auto_closing_brackets ? "always" : "never",
      autoClosingQuotes: settings.auto_closing_quotes ? "always" : "never",
      // 行号紧凑：3 字符宽 + 关闭 glyphMargin + 缩减装饰区
      lineNumbersMinChars: 3,
      glyphMargin: false,
      lineDecorationsWidth: 4,
      folding: true,
      overviewRulerBorder: false,
      hideCursorInOverviewRuler: true,
      // 禁用等宽字体优化：JetBrains Mono Variable 是可变字体，
      // Monaco 缓存的字符宽度与实际渲染不一致会导致光标错位（Windows 已知问题）
      disableMonospaceOptimizations: true,
    });
  }, [settings]);

  // 主题变化时实时切换
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;
    monaco.editor.setTheme(monacoTheme);
  }, [monacoTheme]);

  // 组件卸载时清理补全 provider
  useEffect(() => {
    return () => {
      for (const d of completionDisposablesRef.current) {
        try {
          d.dispose();
        } catch {
          // 忽略
        }
      }
      completionDisposablesRef.current = [];
    };
  }, []);

  return (
    <Editor
      height="100%"
      theme={monacoTheme}
      onMount={handleMount}
      options={{
        fontSize: settings?.font_size ?? 14,
        minimap: { enabled: settings?.minimap_enabled ?? false },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: settings?.indent_size ?? 4,
        insertSpaces: settings?.indent_style !== "tab",
        wordWrap: (settings?.word_wrap ?? "on") as "on" | "off",
        lineNumbers: (settings?.line_numbers ?? "on") as "on" | "off" | "relative",
        fontFamily:
          '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, "SF Mono", Menlo, Monaco, Consolas, monospace',
        quickSuggestions: settings?.enable_suggestions ?? true,
        suggestOnTriggerCharacters: settings?.enable_suggestions ?? true,
        autoClosingBrackets: settings?.auto_closing_brackets ? "always" : "never",
        autoClosingQuotes: settings?.auto_closing_quotes ? "always" : "never",
        renderLineHighlight: "all",
        smoothScrolling: true,
        cursorBlinking: "smooth",
        cursorSmoothCaretAnimation: "on",
        // 行号紧凑：3 字符宽 + 关闭 glyphMargin + 缩减装饰区
        lineNumbersMinChars: 3,
        glyphMargin: false,
        lineDecorationsWidth: 4,
        folding: true,
        overviewRulerBorder: false,
        hideCursorInOverviewRuler: true,
        // 禁用等宽字体优化：可变字体度量不一致会导致光标错位
        disableMonospaceOptimizations: true,
      }}
    />
  );
});

export default EditorPane;
