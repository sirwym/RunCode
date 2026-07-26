import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type { editor as MonacoEditorNS } from "monaco-editor";
import type { EditorSettings, CompileError } from "../types";
import { useTabs } from "../hooks/useTabs";

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
  }, [onRun]);

  // 计算 Monaco 主题：editor.theme 优先，否则用软件 effectiveTheme 推断
  const monacoTheme =
    settings?.theme === "vs" ? "vs"
    : settings?.theme === "hc-black" ? "hc-black"
    : settings?.theme === "vs-dark" ? "vs-dark"
    : theme === "light" ? "vs"
    : "vs-dark";

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
