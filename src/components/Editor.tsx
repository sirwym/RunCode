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
import type { EditorSettings, CompileError } from "../types";
import { useTabs } from "../hooks/useTabs";
import { CPP_KEYWORDS_ALL, type KeywordKind } from "../monaco/cppKeywords";

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

// 持久化 settings.editor.theme → 渲染层 Monaco 主题映射
// - vs-dark → runcode-dark（继承 vs-dark，仅覆盖光标/选区/当前行/焦点）
// - vs      → runcode-light（继承 vs，仅覆盖上述色）
// - hc-black 保留原样（高对比度主题不品牌化）
export function mapMonacoTheme(persisted: string | undefined, fallback: "dark" | "light" | undefined): string {
  if (persisted === "hc-black") return "hc-black";
  if (persisted === "vs") return "runcode-light";
  if (persisted === "vs-dark") return "runcode-dark";
  return fallback === "light" ? "runcode-light" : "runcode-dark";
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
  onRun: () => void;
  /** 光标位置变化回调（用于 StatusBar 显示 Ln/Col） */
  onCursorPositionChange?: (line: number, col: number) => void;
  /** 编辑器设置（来自 settings.editor） */
  settings?: EditorSettings;
  /** 软件主题（仅当 settings.theme 未显式指定时作为 fallback） */
  theme?: "dark" | "light";
}

const EditorPane = forwardRef<EditorHandle, EditorPaneProps>(function EditorPane(
  { onContentChange, onRun, onCursorPositionChange, settings, theme },
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
  // 用 ref 持有最新 onContentChange，避免 model.onDidChangeContent 闭包陈旧
  const onContentChangeRef = useRef(onContentChange);
  onContentChangeRef.current = onContentChange;
  // 用 ref 持有最新 onCursorPositionChange
  const onCursorPositionChangeRef = useRef(onCursorPositionChange);
  onCursorPositionChangeRef.current = onCursorPositionChange;

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

    // 注册 Cmd+Enter / Ctrl+Enter 触发运行
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      onRun();
    });

    // macOS 上 Cmd+Enter 也走上面这条；额外加一条避免被默认换行吞掉
    editor.addCommand(
      monaco.KeyMod.WinCtrl | monaco.KeyCode.Enter,
      () => onRun()
    );

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

    // 代码补全 L2：当前文件符号（函数/全局变量/struct/宏）
    const symbolDisposable = monaco.languages.registerCompletionItemProvider("cpp", {
      triggerCharacters: ["."],
      provideCompletionItems: async (model, position) => {
        const code = model.getValue();
        let symbols: CodeSymbol[] = [];
        try {
          symbols = await invoke<CodeSymbol[]>("extract_code_symbols", { code });
        } catch {
          return { suggestions: [] };
        }
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };
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
  }, [onRun]);

  // 计算 Monaco 主题：持久化值经渲染层映射为 runcode-* 继承主题
  // settings.editor.theme 仍保存 vs-dark / vs / hc-black，避免设置迁移
  const monacoTheme = mapMonacoTheme(settings?.theme, theme);

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
