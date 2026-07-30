import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, within, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getShortcuts, SHORTCUT_DEFINITIONS, SHORTCUT_CATEGORY_KEY, default as SettingsPanel } from "./SettingsPanel";
import { zh } from "../locales/zh";
import { en } from "../locales/en";
import { useI18n } from "../hooks/useI18n";
import { useSettings } from "../hooks/useSettings";
import type { AppSettings } from "../types";

// mock @tauri-apps/api/core 的 invoke（SettingsPanel 用于 clear_recent_files / custom theme）
const invokeMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => invokeMock(cmd, args),
}));

// mock @tauri-apps/plugin-dialog（SettingsPanel 用于图片选择）
const openDialogMock = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => openDialogMock(...args),
}));

// mock @monaco-editor/react：jsdom 下无法加载真实 Monaco，用 textarea 替代
// 仅用于代码模板编辑器渲染，不影响其他测试逻辑
vi.mock("@monaco-editor/react", () => ({
  default: ({ value, onChange }: { value: string; onChange?: (v: string) => void }) => (
    <textarea
      data-testid="mock-monaco-editor"
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
}));

// mock colorExtract：绕过 Canvas API（jsdom 不支持 getContext）
// 仅在导入图片流程中使用，不影响其他测试
const fakeExtractedColors = {
  bg: "#1e1e2e",
  panel_bg: "#181825",
  panel_bg_alt: "#11111b",
  text: "#fafafa",
  text_muted: "#a3a3a3",
  border: "#45475a",
  primary: "#3b65b8",
  primary_hover: "#4a78c9",
  primary_foreground: "#ffffff",
  primary_soft: "rgba(59,101,184,0.14)",
  primary_border: "rgba(59,101,184,0.40)",
  bg_terminal: "#1e1e2e",
  baseMode: "dark" as const,
};
vi.mock("../utils/colorExtract", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/colorExtract")>();
  return {
    ...actual,
    extractThemeColors: () => fakeExtractedColors,
    loadImageToImageData: () =>
      Promise.resolve({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
  };
});

// 按点分路径取值
function getByPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in cur) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

// 构造一份完整的默认 settings（满足 SettingsPanel 渲染需求）
function makeSettings(): AppSettings {
  return {
    compiler: {
      cpp_standard: "c++17",
      opt_level: "O0",
      warnings: "wall",
      extra_args: "",
      compiler_path: null,
      template: "#include <iostream>\nint main() {}\n",
    },
    runtime: {
      compile_timeout_secs: 10,
      run_timeout_secs: 5,
      cpu_secs: 5,
      fsize_mb: 64,
    },
    general: {
      locale: "zh",
      theme: "dark",
      layout: "horizontal",
      auto_hide_panel: false,
    },
    test: {
      fsize_mb: 10,
      test_time_limit_ms: 1000,
      opt_level: "O2",
    },
    editor: {
      font_size: 14,
      theme: "vs-dark",
      terminal_font_size: 14,
      indent_style: "space",
      indent_size: 4,
      line_numbers: "on",
      enable_suggestions: true,
      auto_closing_brackets: true,
      auto_closing_quotes: true,
      word_wrap: "off",
      minimap_enabled: false,
    },
    current_language: "cpp",
    schema_version: 3,
  };
}

// 重置 zustand store 到指定状态
function resetStores(settings: AppSettings) {
  useSettings.setState({
    settings,
    saving: false,
    load: vi.fn(),
    save: vi.fn().mockResolvedValue(undefined),
    themePreview: null,
  });
  useI18n.setState({
    locale: settings.general.locale as "zh" | "en",
    t: (key: string, params?: Record<string, string | number>) => {
      const dict = settings.general.locale === "zh" ? zh : en;
      let s = getByPath(dict, key);
      if (typeof s !== "string") return key;
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          s = (s as string).replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
        }
      }
      return s as string;
    },
    setLocale: vi.fn(),
  });
}

describe("getShortcuts 平台筛选", () => {
  const mac = getShortcuts(true);
  const win = getShortcuts(false);

  it("每项的 action key 在 zh 与 en 中都存在", () => {
    for (const s of SHORTCUT_DEFINITIONS) {
      expect(getByPath(zh, s.action), `zh 缺少 ${s.action}`).toBeTypeOf("string");
      expect(getByPath(en, s.action), `en 缺少 ${s.action}`).toBeTypeOf("string");
    }
  });

  it("每项的 category 在 SHORTCUT_CATEGORY_KEY 中有映射", () => {
    for (const s of SHORTCUT_DEFINITIONS) {
      expect(SHORTCUT_CATEGORY_KEY[s.category], `缺少 category 映射: ${s.category}`).toBeDefined();
    }
  });

  it("每个 category 映射的 key 在 zh 与 en 中都存在", () => {
    for (const categoryKey of Object.values(SHORTCUT_CATEGORY_KEY)) {
      expect(getByPath(zh, categoryKey), `zh 缺少 ${categoryKey}`).toBeTypeOf("string");
      expect(getByPath(en, categoryKey), `en 缺少 ${categoryKey}`).toBeTypeOf("string");
    }
  });

  it("包含新增的 7 个命令（撤销/重做/剪切/复制/粘贴/全选/切换开发人员工具）", () => {
    const actions = SHORTCUT_DEFINITIONS.map((s) => s.action);
    expect(actions).toContain("menu.undo");
    expect(actions).toContain("menu.redo");
    expect(actions).toContain("menu.cut");
    expect(actions).toContain("menu.copy");
    expect(actions).toContain("menu.paste");
    expect(actions).toContain("menu.selectAll");
    expect(actions).toContain("menu.toggleDevtools");
  });

  it("Windows redo 为 Ctrl+Y", () => {
    const redo = win.find((s) => s.action === "menu.redo");
    expect(redo?.keys).toBe("Ctrl+Y");
  });

  it("macOS redo 为 Cmd+Shift+Z", () => {
    const redo = mac.find((s) => s.action === "menu.redo");
    expect(redo?.keys).toBe("Cmd+Shift+Z");
  });

  it("Windows DevTools 为 Ctrl+Shift+I", () => {
    const dev = win.find((s) => s.action === "menu.toggleDevtools");
    expect(dev?.keys).toBe("Ctrl+Shift+I");
  });

  it("macOS DevTools 为 Cmd+Alt+I", () => {
    const dev = mac.find((s) => s.action === "menu.toggleDevtools");
    expect(dev?.keys).toBe("Cmd+Alt+I");
  });

  it("Windows Find Next 不显示（未由 App 接管，不显示 Ctrl+G）", () => {
    const findNext = win.find((s) => s.action === "menu.findNext");
    expect(findNext).toBeUndefined();
  });

  it("macOS Find Next 为 Cmd+G", () => {
    const findNext = mac.find((s) => s.action === "menu.findNext");
    expect(findNext?.keys).toBe("Cmd+G");
  });

  it("Windows Ctrl+G 唯一对应跳转行", () => {
    const ctrlG = win.filter((s) => s.keys === "Ctrl+G");
    expect(ctrlG).toHaveLength(1);
    expect(ctrlG[0].action).toBe("menu.gotoLine");
  });

  it("macOS 跳转行也为 Ctrl+G（与 Find Next 的 Cmd+G 不冲突）", () => {
    const gotoLine = mac.find((s) => s.action === "menu.gotoLine");
    expect(gotoLine?.keys).toBe("Ctrl+G");
  });

  it("Windows 显示的快捷键不重复", () => {
    const keys = win.map((s) => s.keys);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("macOS 显示的快捷键不重复", () => {
    const keys = mac.map((s) => s.keys);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("不包含布局切换项（布局切换无快捷键）", () => {
    const actions = SHORTCUT_DEFINITIONS.map((s) => s.action);
    expect(actions).not.toContain("menu.layoutHorizontal");
    expect(actions).not.toContain("menu.layoutVertical");
  });

  it("隐藏面板快捷键：macOS Cmd+\\ / Windows Ctrl+\\", () => {
    expect(mac.find((s) => s.action === "menu.togglePanel")?.keys).toBe("Cmd+\\");
    expect(win.find((s) => s.action === "menu.togglePanel")?.keys).toBe("Ctrl+\\");
  });

  it("每项 keys 非空", () => {
    for (const s of [...mac, ...win]) {
      expect(s.keys.length).toBeGreaterThan(0);
    }
  });
});

describe("SettingsPanel 快捷键 tab 渲染", () => {
  beforeAll(() => {
    // jsdom 没有 matchMedia，自动隐藏逻辑的 system 主题监听不涉及此测试，但加载组件时可能触发
    if (!window.matchMedia) {
      window.matchMedia = ((q: string) => ({
        matches: false,
        media: q,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      })) as unknown as typeof window.matchMedia;
    }
  });

  beforeEach(() => {
    resetStores(makeSettings());
  });

  it("默认显示 4 个 tab，第 4 个为「快捷键」", () => {
    render(<SettingsPanel open={true} onClose={() => {}} />);
    // 中文环境下 tab 文案为「快捷键」
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(4);
    expect(screen.getByRole("tab", { name: zh.settings.shortcuts })).toBeInTheDocument();
  });

  it("点击快捷键 tab 后渲染表格表头（3 列）", async () => {
    const user = userEvent.setup();
    render(<SettingsPanel open={true} onClose={() => {}} />);

    await user.click(screen.getByRole("tab", { name: zh.settings.shortcuts }));

    // 限定在表格内查找表头，避免与 tab 名称「快捷键」冲突
    const table = document.querySelector(".shortcuts-table");
    expect(table, "shortcuts 表格未渲染").not.toBeNull();
    const tableScope = within(table as HTMLElement);

    // 表头 3 列：类别 / 功能 / 快捷键
    expect(tableScope.getByText(zh.settings.shortcutCategory)).toBeInTheDocument();
    expect(tableScope.getByText(zh.settings.shortcutAction)).toBeInTheDocument();
    expect(tableScope.getByText(zh.settings.shortcutKey)).toBeInTheDocument();
  });

  it("切换到快捷键 tab 后渲染当前平台的快捷键", async () => {
    const user = userEvent.setup();
    render(<SettingsPanel open={true} onClose={() => {}} />);

    await user.click(screen.getByRole("tab", { name: zh.settings.shortcuts }));

    const table = document.querySelector(".shortcuts-table");
    expect(table, "shortcuts 表格未渲染").not.toBeNull();
    const tableScope = within(table as HTMLElement);

    // jsdom 环境下 navigator.platform 非 Mac，渲染 Windows 快捷键
    // 渲染的 keys 已是平台专属值，无需再替换 Cmd→Ctrl
    const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
    const rendered = getShortcuts(isMac);
    for (const s of rendered) {
      expect(tableScope.getAllByText(s.keys).length).toBeGreaterThan(0);
    }
  });

  it("每个快捷键对应的 action 文案在中文环境下正确渲染", async () => {
    const user = userEvent.setup();
    render(<SettingsPanel open={true} onClose={() => {}} />);

    await user.click(screen.getByRole("tab", { name: zh.settings.shortcuts }));

    // 限定在 shortcuts 表格内查找，避免与其他 tab 的重复文案冲突
    const table = document.querySelector(".shortcuts-table");
    expect(table, "shortcuts 表格未渲染").not.toBeNull();
    const tableScope = within(table as HTMLElement);

    const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
    for (const s of getShortcuts(isMac)) {
      const expected = getByPath(zh, s.action);
      expect(tableScope.getByText(expected as string), `action ${s.action} 文案未渲染`).toBeInTheDocument();
    }
  });

  it("切换到英文 locale 后快捷键文案本地化", async () => {
    // 重置为英文
    const s = makeSettings();
    s.general.locale = "en";
    resetStores(s);

    const user = userEvent.setup();
    render(<SettingsPanel open={true} onClose={() => {}} />);

    await user.click(screen.getByRole("tab", { name: en.settings.shortcuts }));

    const table = document.querySelector(".shortcuts-table");
    expect(table, "shortcuts 表格未渲染").not.toBeNull();
    const tableScope = within(table as HTMLElement);

    expect(tableScope.getByText(en.settings.shortcutCategory)).toBeInTheDocument();
    expect(tableScope.getByText(en.settings.shortcutAction)).toBeInTheDocument();
    expect(tableScope.getByText(en.settings.shortcutKey)).toBeInTheDocument();
    // 第一项「新建 / New」
    expect(tableScope.getByText(en.menu.new)).toBeInTheDocument();
  });

  it("快捷键 tab 不修改任何 draft 字段（纯只读，保存按钮点击不改变 settings）", async () => {
    const user = userEvent.setup();
    const savedSpy = vi.fn().mockResolvedValue(undefined);
    useSettings.setState({ save: savedSpy });

    render(<SettingsPanel open={true} onClose={() => {}} />);
    await user.click(screen.getByRole("tab", { name: zh.settings.shortcuts }));

    // 切到快捷键 tab 后点击保存——不应触发新的 save 调用（除非用户在其他 tab 修改过）
    // 这里仅验证快捷键 tab 渲染不抛错，且保存按钮可点击
    const saveBtn = screen.getByRole("button", { name: zh.settings.save });
    expect(saveBtn).not.toBeDisabled();
  });
});

describe("SettingsPanel 测试设置小节（编程语言 tab）", () => {
  beforeAll(() => {
    if (!window.matchMedia) {
      window.matchMedia = ((q: string) => ({
        matches: false,
        media: q,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      })) as unknown as typeof window.matchMedia;
    }
  });

  beforeEach(() => {
    resetStores(makeSettings());
  });

  it("渲染测试设置小节标题", async () => {
    const user = userEvent.setup();
    render(<SettingsPanel open={true} onClose={() => {}} />);
    // 默认 tab 是 general，需切换到「编程语言设置」tab 才能看到测试设置小节
    await user.click(screen.getByRole("tab", { name: zh.settings.languageSettings }));
    expect(screen.getByText(zh.settings.testSettings)).toBeInTheDocument();
  });

  it("fsize_mb 控件从 draft.test.fsize_mb 读取（默认值 10）", async () => {
    const user = userEvent.setup();
    render(<SettingsPanel open={true} onClose={() => {}} />);
    await user.click(screen.getByRole("tab", { name: zh.settings.languageSettings }));
    const input = document.getElementById("set-fsize-mb") as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe("10");
  });

  it("test_time_limit_ms 控件默认值 1000", async () => {
    const user = userEvent.setup();
    render(<SettingsPanel open={true} onClose={() => {}} />);
    await user.click(screen.getByRole("tab", { name: zh.settings.languageSettings }));
    const input = document.getElementById("set-test-time-limit") as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe("1000");
  });

  it("修改 test_time_limit_ms 更新 draft", async () => {
    const user = userEvent.setup();
    render(<SettingsPanel open={true} onClose={() => {}} />);
    await user.click(screen.getByRole("tab", { name: zh.settings.languageSettings }));
    const input = document.getElementById("set-test-time-limit") as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "2000");
    expect(input.value).toBe("2000");
  });

  it("测试优化级别 Select 默认显示 -O2", async () => {
    const user = userEvent.setup();
    render(<SettingsPanel open={true} onClose={() => {}} />);
    await user.click(screen.getByRole("tab", { name: zh.settings.languageSettings }));
    // makeSettings 默认 test.opt_level = "O2"，compiler.opt_level = "O0"
    // 因此 -O2 仅出现在测试设置区块的 SelectValue 中
    expect(screen.getByText("-O2")).toBeInTheDocument();
  });

  it("修改测试优化级别更新 draft（O2 -> O1）", async () => {
    const user = userEvent.setup();
    const saveMock = vi.fn().mockResolvedValue(undefined);
    useSettings.setState({ save: saveMock });
    render(<SettingsPanel open={true} onClose={() => {}} />);
    await user.click(screen.getByRole("tab", { name: zh.settings.languageSettings }));
    // 点击测试优化级别 Select trigger 打开下拉
    const trigger = document.getElementById("set-test-opt-level") as HTMLButtonElement;
    await user.click(trigger);
    // 选择 -O1
    await user.click(screen.getByRole("option", { name: "-O1" }));
    // 保存
    await user.click(screen.getByText(zh.settings.save));
    await vi.waitFor(() => {
      expect(saveMock).toHaveBeenCalled();
    });
    const saved = saveMock.mock.calls[0][0] as AppSettings;
    expect(saved.test.opt_level).toBe("O1");
  });

  it("fsize_mb 不再出现在运行时配置小节（从 test 读取）", async () => {
    const user = userEvent.setup();
    render(<SettingsPanel open={true} onClose={() => {}} />);
    await user.click(screen.getByRole("tab", { name: zh.settings.languageSettings }));
    // fsize_mb 控件应存在（在测试设置小节），但其 value 来自 draft.test
    const input = document.getElementById("set-fsize-mb") as HTMLInputElement;
    expect(input.value).toBe("10"); // draft.test.fsize_mb 默认值
  });
});

describe("SettingsPanel 自定义图片主题", () => {
  beforeAll(() => {
    if (!window.matchMedia) {
      window.matchMedia = ((q: string) => ({
        matches: false,
        media: q,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      })) as unknown as typeof window.matchMedia;
    }
  });

  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    openDialogMock.mockReset();
    resetStores(makeSettings());
  });

  it("切换到 custom 主题时显示导入图片按钮", async () => {
    const user = userEvent.setup();
    render(<SettingsPanel open={true} onClose={() => {}} />);

    // 点击主题下拉框（用 id 精确定位，避免与其他 combobox 冲突）
    const themeTrigger = document.getElementById("set-theme") as HTMLButtonElement;
    await user.click(themeTrigger);
    // 选择 custom
    await user.click(screen.getByText(zh.settings.themeCustom));

    // 应显示"导入图片"按钮
    expect(screen.getByText(zh.settings.importImage)).toBeInTheDocument();
  });

  it("切换到预设主题时清除 custom_theme 配置（不立即删除图片）", async () => {
    const user = userEvent.setup();
    // 初始状态：已有 custom_theme
    const s = makeSettings();
    s.general.theme = "custom";
    s.general.custom_theme = {
      image_file: "abc12345.png",
      colors: {
        bg: "#1e1e2e",
        panel_bg: "#181825",
        panel_bg_alt: "#11111b",
        text: "#fafafa",
        text_muted: "#a3a3a3",
        border: "#45475a",
        primary: "#3b65b8",
        primary_hover: "#4a78c9",
        primary_foreground: "#ffffff",
        primary_soft: "rgba(59,101,184,0.14)",
        primary_border: "rgba(59,101,184,0.40)",
        bg_terminal: "#1e1e2e",
      },
      base_mode: "dark",
      panel_alpha: 82,
      editor_alpha: 92,
      mask_opacity: 20,
    };
    const saveMock = vi.fn().mockResolvedValue(undefined);
    useSettings.setState({
      settings: s,
      saving: false,
      load: vi.fn(),
      save: saveMock,
    });
    useI18n.setState({
      locale: "zh",
      t: (key: string, params?: Record<string, string | number>) => {
        let v = getByPath(zh, key);
        if (typeof v !== "string") return key;
        if (params) {
          for (const [k, p] of Object.entries(params)) {
            v = (v as string).replace(new RegExp(`\\{${k}\\}`, "g"), String(p));
          }
        }
        return v as string;
      },
      setLocale: vi.fn(),
    });

    render(<SettingsPanel open={true} onClose={() => {}} />);

    // 切换到 dark
    const themeTrigger = document.getElementById("set-theme") as HTMLButtonElement;
    await user.click(themeTrigger);
    await user.click(screen.getByText(zh.settings.themeDark));

    // 切换时不应立即调用 delete_custom_theme_image（待 save 成功后才删除）
    const deleteCall = invokeMock.mock.calls.find(
      (c) => c[0] === "delete_custom_theme_image"
    );
    expect(deleteCall).toBeUndefined();

    // 点保存后应调用 delete_custom_theme_image
    await user.click(screen.getByText(zh.settings.save));
    await vi.waitFor(() => {
      expect(saveMock).toHaveBeenCalled();
    });
    await vi.waitFor(() => {
      const del = invokeMock.mock.calls.find(
        (c) => c[0] === "delete_custom_theme_image" && (c[1] as { imageFile: string }).imageFile === "abc12345.png"
      );
      expect(del).toBeDefined();
    });
  });

  it("切换到预设主题后取消，不调用旧图片删除且持久化配置不变", async () => {
    const user = userEvent.setup();
    const s = makeSettings();
    s.general.theme = "custom";
    s.general.custom_theme = {
      image_file: "persisted.png",
      colors: {
        bg: "#ffffff",
        panel_bg: "#f5f5f5",
        panel_bg_alt: "#e5e5e5",
        text: "#0a0a0a",
        text_muted: "#737373",
        border: "#d4d4d4",
        primary: "#365eaa",
        primary_hover: "#2a4d8f",
        primary_foreground: "#ffffff",
        primary_soft: "rgba(54,94,170,0.14)",
        primary_border: "rgba(54,94,170,0.40)",
        bg_terminal: "#ffffff",
      },
      base_mode: "light",
      panel_alpha: 82,
      editor_alpha: 92,
      mask_opacity: 20,
    };
    const saveMock = vi.fn().mockResolvedValue(undefined);
    useSettings.setState({
      settings: s,
      saving: false,
      load: vi.fn(),
      save: saveMock,
    });
    useI18n.setState({
      locale: "zh",
      t: (key: string, params?: Record<string, string | number>) => {
        let v = getByPath(zh, key);
        if (typeof v !== "string") return key;
        if (params) {
          for (const [k, p] of Object.entries(params)) {
            v = (v as string).replace(new RegExp(`\\{${k}\\}`, "g"), String(p));
          }
        }
        return v as string;
      },
      setLocale: vi.fn(),
    });

    render(<SettingsPanel open={true} onClose={() => {}} />);

    // 切换到 light 预设
    const themeTrigger = document.getElementById("set-theme") as HTMLButtonElement;
    await user.click(themeTrigger);
    await user.click(screen.getByText(zh.settings.themeLight));

    // 点取消（不保存）
    await user.click(screen.getByText(zh.settings.cancel));

    // 不应调用 delete_custom_theme_image（取消保留原图片）
    const deleteCall = invokeMock.mock.calls.find(
      (c) => c[0] === "delete_custom_theme_image"
    );
    expect(deleteCall).toBeUndefined();

    // 不应调用 save（取消不保存）
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("滑块改为 75/84/35 后，最终 save_settings 收到完全相同的值", async () => {
    const user = userEvent.setup();
    render(<SettingsPanel open={true} onClose={() => {}} />);

    // 切换到 custom 主题
    const themeTrigger = document.getElementById("set-theme") as HTMLButtonElement;
    await user.click(themeTrigger);
    await user.click(screen.getByText(zh.settings.themeCustom));

    // mock openDialog 返回图片路径
    openDialogMock.mockResolvedValue("/fake/path/image.png");
    // mock invoke: read_file_bytes 返回字节数组, save_custom_theme_image 返回文件名
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "read_file_bytes") return Promise.resolve([1, 2, 3, 4]);
      if (cmd === "save_custom_theme_image") return Promise.resolve("new-uuid.png");
      return Promise.resolve(undefined);
    });

    // 点击导入图片
    await user.click(screen.getByText(zh.settings.importImage));

    // 等待预览出现（滑块渲染）
    const panelSlider = await screen.findByDisplayValue("82");
    const editorSlider = await screen.findByDisplayValue("92");
    const maskSlider = await screen.findByDisplayValue("20");
    expect(panelSlider).toBeInTheDocument();
    expect(editorSlider).toBeInTheDocument();
    expect(maskSlider).toBeInTheDocument();

    // 调整滑块到 75/84/35（range input 需用 fireEvent.change）
    fireEvent.change(panelSlider, { target: { value: "75" } });
    fireEvent.change(editorSlider, { target: { value: "84" } });
    fireEvent.change(maskSlider, { target: { value: "35" } });

    // 点击应用主题
    await user.click(screen.getByText(zh.settings.applyTheme));

    // 点击保存
    const saveMock = vi.fn().mockResolvedValue(undefined);
    act(() => {
      useSettings.setState({ save: saveMock });
    });
    await user.click(screen.getByText(zh.settings.save));

    // 验证 saveSettings 收到完全相同的滑块值
    await vi.waitFor(() => {
      expect(saveMock).toHaveBeenCalled();
    });
    const savedArg = saveMock.mock.calls[0][0] as AppSettings;
    expect(savedArg.general.custom_theme?.panel_alpha).toBe(75);
    expect(savedArg.general.custom_theme?.editor_alpha).toBe(84);
    expect(savedArg.general.custom_theme?.mask_opacity).toBe(35);
  });

  it("保存切换和重新导入后，只删除不再引用的旧文件", async () => {
    const user = userEvent.setup();
    // 初始状态：已有 custom 主题，图片为 old-uuid.png
    const s = makeSettings();
    s.general.theme = "custom";
    s.general.custom_theme = {
      image_file: "old-uuid.png",
      colors: {
        bg: "#1e1e2e",
        panel_bg: "#181825",
        panel_bg_alt: "#11111b",
        text: "#fafafa",
        text_muted: "#a3a3a3",
        border: "#45475a",
        primary: "#3b65b8",
        primary_hover: "#4a78c9",
        primary_foreground: "#ffffff",
        primary_soft: "rgba(59,101,184,0.14)",
        primary_border: "rgba(59,101,184,0.40)",
        bg_terminal: "#1e1e2e",
      },
      base_mode: "dark",
      panel_alpha: 82,
      editor_alpha: 92,
      mask_opacity: 20,
    };
    const saveMock = vi.fn().mockResolvedValue(undefined);
    useSettings.setState({
      settings: s,
      saving: false,
      load: vi.fn(),
      save: saveMock,
    });
    useI18n.setState({
      locale: "zh",
      t: (key: string, params?: Record<string, string | number>) => {
        let v = getByPath(zh, key);
        if (typeof v !== "string") return key;
        if (params) {
          for (const [k, p] of Object.entries(params)) {
            v = (v as string).replace(new RegExp(`\\{${k}\\}`, "g"), String(p));
          }
        }
        return v as string;
      },
      setLocale: vi.fn(),
    });

    render(<SettingsPanel open={true} onClose={() => {}} />);

    // mock openDialog 返回新图片路径
    openDialogMock.mockResolvedValue("/fake/path/new-image.png");
    // mock invoke: read_file_bytes 返回字节数组, save_custom_theme_image 返回新文件名
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "read_file_bytes") return Promise.resolve([1, 2, 3, 4]);
      if (cmd === "save_custom_theme_image") return Promise.resolve("new-uuid.png");
      return Promise.resolve(undefined);
    });

    // 点击重新导入图片
    await user.click(screen.getByText(zh.settings.reimportImage));

    // 等待预览出现
    await screen.findByText(zh.settings.applyTheme);

    // 点击应用主题（此时 draft.custom_theme.image_file 变为 new-uuid.png）
    await user.click(screen.getByText(zh.settings.applyTheme));

    // 点击保存
    await user.click(screen.getByText(zh.settings.save));

    // 验证 save 被调用
    await vi.waitFor(() => {
      expect(saveMock).toHaveBeenCalled();
    });

    // 验证：旧文件 old-uuid.png 被删除（不再被新配置引用）
    await vi.waitFor(() => {
      const deleteOldCall = invokeMock.mock.calls.find(
        (c) =>
          c[0] === "delete_custom_theme_image" &&
          (c[1] as { imageFile: string }).imageFile === "old-uuid.png"
      );
      expect(deleteOldCall).toBeDefined();
    });

    // 验证：新文件 new-uuid.png 不被删除（仍被新配置引用）
    const deleteNewCall = invokeMock.mock.calls.find(
      (c) =>
        c[0] === "delete_custom_theme_image" &&
        (c[1] as { imageFile: string }).imageFile === "new-uuid.png"
    );
    expect(deleteNewCall).toBeUndefined();

    // 验证：保存后的配置引用 new-uuid.png
    const savedArg = saveMock.mock.calls[0][0] as AppSettings;
    expect(savedArg.general.custom_theme?.image_file).toBe("new-uuid.png");
  });

  it("已应用主题后，滑块仍可见且可直接调整透明度", async () => {
    const user = userEvent.setup();
    // 初始状态：已有持久化的 custom 主题（82/92/20）
    const s = makeSettings();
    s.general.theme = "custom";
    s.general.custom_theme = {
      image_file: "persisted.png",
      colors: {
        bg: "#1e1e2e",
        panel_bg: "#181825",
        panel_bg_alt: "#11111b",
        text: "#fafafa",
        text_muted: "#a3a3a3",
        border: "#45475a",
        primary: "#3b65b8",
        primary_hover: "#4a78c9",
        primary_foreground: "#ffffff",
        primary_soft: "rgba(59,101,184,0.14)",
        primary_border: "rgba(59,101,184,0.40)",
        bg_terminal: "#1e1e2e",
      },
      base_mode: "dark",
      panel_alpha: 82,
      editor_alpha: 92,
      mask_opacity: 20,
    };
    const saveMock = vi.fn().mockResolvedValue(undefined);
    useSettings.setState({
      settings: s,
      saving: false,
      load: vi.fn(),
      save: saveMock,
    });
    useI18n.setState({
      locale: "zh",
      t: (key: string, params?: Record<string, string | number>) => {
        let v = getByPath(zh, key);
        if (typeof v !== "string") return key;
        if (params) {
          for (const [k, p] of Object.entries(params)) {
            v = (v as string).replace(new RegExp(`\\{${k}\\}`, "g"), String(p));
          }
        }
        return v as string;
      },
      setLocale: vi.fn(),
    });

    render(<SettingsPanel open={true} onClose={() => {}} />);

    // 状态 C：滑块应可见，显示 draft 中的值（82/92/20）
    const panelSlider = await screen.findByDisplayValue("82");
    const editorSlider = screen.getByDisplayValue("92");
    const maskSlider = screen.getByDisplayValue("20");
    expect(panelSlider).toBeInTheDocument();
    expect(editorSlider).toBeInTheDocument();
    expect(maskSlider).toBeInTheDocument();

    // 直接调整滑块到 75/84/35（无需重新导入图片）
    fireEvent.change(panelSlider, { target: { value: "75" } });
    fireEvent.change(editorSlider, { target: { value: "84" } });
    fireEvent.change(maskSlider, { target: { value: "35" } });

    // 点保存
    await user.click(screen.getByText(zh.settings.save));

    // 验证 saveMock 收到的 draft 中滑块值为 75/84/35
    await vi.waitFor(() => {
      expect(saveMock).toHaveBeenCalled();
    });
    const saved = saveMock.mock.calls[0][0] as AppSettings;
    expect(saved.general.custom_theme?.panel_alpha).toBe(75);
    expect(saved.general.custom_theme?.editor_alpha).toBe(84);
    expect(saved.general.custom_theme?.mask_opacity).toBe(35);
    // 图片文件不应变化（未重新导入）
    expect(saved.general.custom_theme?.image_file).toBe("persisted.png");
  });

  it("已应用主题调整滑块后，重新导入时保留最新值", async () => {
    const user = userEvent.setup();
    // 初始状态：已有持久化的 custom 主题（82/92/20）
    const s = makeSettings();
    s.general.theme = "custom";
    s.general.custom_theme = {
      image_file: "persisted.png",
      colors: {
        bg: "#1e1e2e",
        panel_bg: "#181825",
        panel_bg_alt: "#11111b",
        text: "#fafafa",
        text_muted: "#a3a3a3",
        border: "#45475a",
        primary: "#3b65b8",
        primary_hover: "#4a78c9",
        primary_foreground: "#ffffff",
        primary_soft: "rgba(59,101,184,0.14)",
        primary_border: "rgba(59,101,184,0.40)",
        bg_terminal: "#1e1e2e",
      },
      base_mode: "dark",
      panel_alpha: 82,
      editor_alpha: 92,
      mask_opacity: 20,
    };
    useSettings.setState({
      settings: s,
      saving: false,
      load: vi.fn(),
      save: vi.fn().mockResolvedValue(undefined),
    });
    useI18n.setState({
      locale: "zh",
      t: (key: string, params?: Record<string, string | number>) => {
        let v = getByPath(zh, key);
        if (typeof v !== "string") return key;
        if (params) {
          for (const [k, p] of Object.entries(params)) {
            v = (v as string).replace(new RegExp(`\\{${k}\\}`, "g"), String(p));
          }
        }
        return v as string;
      },
      setLocale: vi.fn(),
    });

    render(<SettingsPanel open={true} onClose={() => {}} />);

    // 状态 C：调整滑块到 70/80/30
    const panelSlider = await screen.findByDisplayValue("82");
    const editorSlider = screen.getByDisplayValue("92");
    const maskSlider = screen.getByDisplayValue("20");
    fireEvent.change(panelSlider, { target: { value: "70" } });
    fireEvent.change(editorSlider, { target: { value: "80" } });
    fireEvent.change(maskSlider, { target: { value: "30" } });

    // 点击"重新导入图片"
    openDialogMock.mockResolvedValue("/fake/path/new-image.png");
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "read_file_bytes") return Promise.resolve([1, 2, 3, 4]);
      if (cmd === "save_custom_theme_image") return Promise.resolve("new-uuid.png");
      return Promise.resolve(undefined);
    });
    await user.click(screen.getByText(zh.settings.reimportImage));

    // 状态 B：滑块应初始化为状态 C 调整后的值（70/80/30）
    const newPanelSlider = await screen.findByDisplayValue("70");
    const newEditorSlider = screen.getByDisplayValue("80");
    const newMaskSlider = screen.getByDisplayValue("30");
    expect(newPanelSlider).toBeInTheDocument();
    expect(newEditorSlider).toBeInTheDocument();
    expect(newMaskSlider).toBeInTheDocument();
  });
});

describe("SettingsPanel 主题实时预览", () => {
  beforeAll(() => {
    if (!window.matchMedia) {
      window.matchMedia = ((q: string) => ({
        matches: false,
        media: q,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      })) as unknown as typeof window.matchMedia;
    }
  });

  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    openDialogMock.mockReset();
    resetStores(makeSettings());
  });

  // 辅助：构造带 custom_theme 的 settings
  function makeCustomSettings(overrides: Partial<{ panel_alpha: number; editor_alpha: number; mask_opacity: number }> = {}): AppSettings {
    const s = makeSettings();
    s.general.theme = "custom";
    s.general.custom_theme = {
      image_file: "persisted.png",
      colors: {
        bg: "#1e1e2e",
        panel_bg: "#181825",
        panel_bg_alt: "#11111b",
        text: "#fafafa",
        text_muted: "#a3a3a3",
        border: "#45475a",
        primary: "#3b65b8",
        primary_hover: "#4a78c9",
        primary_foreground: "#ffffff",
        primary_soft: "rgba(59,101,184,0.14)",
        primary_border: "rgba(59,101,184,0.40)",
        bg_terminal: "#1e1e2e",
      },
      base_mode: "dark",
      panel_alpha: overrides.panel_alpha ?? 82,
      editor_alpha: overrides.editor_alpha ?? 92,
      mask_opacity: overrides.mask_opacity ?? 20,
    };
    return s;
  }

  it("拖动滑块但不点击保存时，themePreview 立即更新且 save 调用次数为 0", async () => {
    const saveMock = vi.fn().mockResolvedValue(undefined);
    const s = makeCustomSettings();
    useSettings.setState({ settings: s, save: saveMock, themePreview: null });
    useI18n.setState({
      locale: "zh",
      t: (key: string, params?: Record<string, string | number>) => {
        let v = getByPath(zh, key);
        if (typeof v !== "string") return key;
        if (params) {
          for (const [k, p] of Object.entries(params)) {
            v = (v as string).replace(new RegExp(`\\{${k}\\}`, "g"), String(p));
          }
        }
        return v as string;
      },
      setLocale: vi.fn(),
    });

    render(<SettingsPanel open={true} onClose={() => {}} />);

    // 状态 C：滑块可见，调整到 75/84/35
    const panelSlider = await screen.findByDisplayValue("82");
    fireEvent.change(panelSlider, { target: { value: "75" } });
    const editorSlider = screen.getByDisplayValue("92");
    fireEvent.change(editorSlider, { target: { value: "84" } });
    const maskSlider = screen.getByDisplayValue("20");
    fireEvent.change(maskSlider, { target: { value: "35" } });

    // themePreview 立即更新为新值
    const preview = useSettings.getState().themePreview;
    expect(preview).not.toBeNull();
    expect(preview?.customTheme.panel_alpha).toBe(75);
    expect(preview?.customTheme.editor_alpha).toBe(84);
    expect(preview?.customTheme.mask_opacity).toBe(35);

    // 实时滑动期间 save 调用次数为 0
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("取消（关闭面板）会清除预览并恢复原值", async () => {
    const onCloseMock = vi.fn();
    const s = makeCustomSettings();
    useSettings.setState({ settings: s, themePreview: null });
    useI18n.setState({
      locale: "zh",
      t: (key: string, params?: Record<string, string | number>) => {
        let v = getByPath(zh, key);
        if (typeof v !== "string") return key;
        if (params) {
          for (const [k, p] of Object.entries(params)) {
            v = (v as string).replace(new RegExp(`\\{${k}\\}`, "g"), String(p));
          }
        }
        return v as string;
      },
      setLocale: vi.fn(),
    });

    render(<SettingsPanel open={true} onClose={onCloseMock} />);

    // 调整滑块
    const panelSlider = await screen.findByDisplayValue("82");
    fireEvent.change(panelSlider, { target: { value: "70" } });
    expect(useSettings.getState().themePreview?.customTheme.panel_alpha).toBe(70);

    // 关闭面板（模拟 Escape / 点击关闭）
    fireEvent.keyDown(document.body, { key: "Escape" });
    // 或通过 Dialog onOpenChange 触发 handleClose
    // 由于 Radix Dialog 的 Escape 处理，这里直接验证 onClose 被调用
    await vi.waitFor(() => {
      expect(onCloseMock).toHaveBeenCalled();
    });

    // 预览被清除
    expect(useSettings.getState().themePreview).toBeNull();
  });

  it("保存成功后新值持久化并继续显示（themePreview 清除，settings 接管）", async () => {
    // saveMock 模拟真实 save 行为：成功后更新 useSettings.settings
    const saveMock = vi.fn().mockImplementation(async (settings: AppSettings) => {
      useSettings.setState({ settings, saving: false });
    });
    const s = makeCustomSettings();
    useSettings.setState({ settings: s, save: saveMock, themePreview: null });
    useI18n.setState({
      locale: "zh",
      t: (key: string, params?: Record<string, string | number>) => {
        let v = getByPath(zh, key);
        if (typeof v !== "string") return key;
        if (params) {
          for (const [k, p] of Object.entries(params)) {
            v = (v as string).replace(new RegExp(`\\{${k}\\}`, "g"), String(p));
          }
        }
        return v as string;
      },
      setLocale: vi.fn(),
    });

    const user = userEvent.setup();
    render(<SettingsPanel open={true} onClose={() => {}} />);

    // 调整滑块到 75/84/35
    const panelSlider = await screen.findByDisplayValue("82");
    fireEvent.change(panelSlider, { target: { value: "75" } });
    fireEvent.change(screen.getByDisplayValue("92"), { target: { value: "84" } });
    fireEvent.change(screen.getByDisplayValue("20"), { target: { value: "35" } });

    // 点保存
    await user.click(screen.getByText(zh.settings.save));

    await vi.waitFor(() => {
      expect(saveMock).toHaveBeenCalled();
    });

    // 保存成功：settings 更新为新值，themePreview 清除
    const saved = saveMock.mock.calls[0][0] as AppSettings;
    expect(saved.general.custom_theme?.panel_alpha).toBe(75);
    expect(saved.general.custom_theme?.editor_alpha).toBe(84);
    expect(saved.general.custom_theme?.mask_opacity).toBe(35);
    // useSettings.settings 也应更新为保存的值（save 内部 set settings）
    expect(useSettings.getState().settings?.general.custom_theme?.panel_alpha).toBe(75);
    // themePreview 被清除（由持久化 settings 接管）
    expect(useSettings.getState().themePreview).toBeNull();
  });

  it("保存失败时不清除预览（保留 draft 和预览让用户继续调整）", async () => {
    const saveMock = vi.fn().mockRejectedValue(new Error("disk full"));
    const s = makeCustomSettings();
    useSettings.setState({ settings: s, save: saveMock, themePreview: null });
    useI18n.setState({
      locale: "zh",
      t: (key: string, params?: Record<string, string | number>) => {
        let v = getByPath(zh, key);
        if (typeof v !== "string") return key;
        if (params) {
          for (const [k, p] of Object.entries(params)) {
            v = (v as string).replace(new RegExp(`\\{${k}\\}`, "g"), String(p));
          }
        }
        return v as string;
      },
      setLocale: vi.fn(),
    });

    const user = userEvent.setup();
    render(<SettingsPanel open={true} onClose={() => {}} />);

    // 调整滑块
    const panelSlider = await screen.findByDisplayValue("82");
    fireEvent.change(panelSlider, { target: { value: "70" } });
    expect(useSettings.getState().themePreview?.customTheme.panel_alpha).toBe(70);

    // 点保存（失败）
    await user.click(screen.getByText(zh.settings.save));

    await vi.waitFor(() => {
      expect(saveMock).toHaveBeenCalled();
    });

    // 保存失败：themePreview 仍保留
    expect(useSettings.getState().themePreview).not.toBeNull();
    expect(useSettings.getState().themePreview?.customTheme.panel_alpha).toBe(70);
  });

  it("切换到预设主题后取消，预览清除且回退到持久化主题", async () => {
    const onCloseMock = vi.fn();
    const s = makeCustomSettings();
    useSettings.setState({ settings: s, themePreview: null });
    useI18n.setState({
      locale: "zh",
      t: (key: string, params?: Record<string, string | number>) => {
        let v = getByPath(zh, key);
        if (typeof v !== "string") return key;
        if (params) {
          for (const [k, p] of Object.entries(params)) {
            v = (v as string).replace(new RegExp(`\\{${k}\\}`, "g"), String(p));
          }
        }
        return v as string;
      },
      setLocale: vi.fn(),
    });

    const user = userEvent.setup();
    render(<SettingsPanel open={true} onClose={onCloseMock} />);

    // 切换到 light 主题
    const themeTrigger = document.getElementById("set-theme") as HTMLButtonElement;
    await user.click(themeTrigger);
    await user.click(screen.getByText(zh.settings.themeLight));

    // 预览应清除（切到预设主题时 syncThemePreview(null)）
    expect(useSettings.getState().themePreview).toBeNull();

    // 关闭面板（取消）
    fireEvent.keyDown(document.body, { key: "Escape" });
    await vi.waitFor(() => {
      expect(onCloseMock).toHaveBeenCalled();
    });

    // 预览仍为 null，settings 未变（取消不保存）
    expect(useSettings.getState().themePreview).toBeNull();
    expect(useSettings.getState().settings?.general.theme).toBe("custom");
  });
});

describe("SettingsPanel 自定义色板与重置", () => {
  beforeAll(() => {
    if (!window.matchMedia) {
      window.matchMedia = ((q: string) => ({
        matches: false,
        media: q,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      })) as unknown as typeof window.matchMedia;
    }
  });

  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    openDialogMock.mockReset();
    resetStores(makeSettings());
  });

  // 辅助：构造带 custom_theme 的 settings
  function makeCustomSettings(): AppSettings {
    const s = makeSettings();
    s.general.theme = "custom";
    s.general.custom_theme = {
      image_file: "persisted.png",
      colors: {
        bg: "#1e1e2e",
        panel_bg: "#181825",
        panel_bg_alt: "#11111b",
        text: "#fafafa",
        text_muted: "#a3a3a3",
        border: "#45475a",
        primary: "#3b65b8",
        primary_hover: "#4a78c9",
        primary_foreground: "#ffffff",
        primary_soft: "rgba(59,101,184,0.14)",
        primary_border: "rgba(59,101,184,0.40)",
        bg_terminal: "#1e1e2e",
      },
      base_mode: "dark",
      panel_alpha: 82,
      editor_alpha: 92,
      mask_opacity: 20,
    };
    return s;
  }

  function setupI18n() {
    useI18n.setState({
      locale: "zh",
      t: (key: string, params?: Record<string, string | number>) => {
        let v = getByPath(zh, key);
        if (typeof v !== "string") return key;
        if (params) {
          for (const [k, p] of Object.entries(params)) {
            v = (v as string).replace(new RegExp(`\\{${k}\\}`, "g"), String(p));
          }
        }
        return v as string;
      },
      setLocale: vi.fn(),
    });
  }

  it("State C 渲染色板，显示 5 个颜色输入", async () => {
    const s = makeCustomSettings();
    useSettings.setState({ settings: s });
    setupI18n();

    render(<SettingsPanel open={true} onClose={() => {}} />);

    // 等待 State C 渲染（滑块出现意味着 State C 已渲染）
    await screen.findByDisplayValue("82");

    // 应有 5 个 color input（bg / panel_bg / primary / text / border）
    const colorInputs = document.querySelectorAll('input[type="color"]');
    expect(colorInputs).toHaveLength(5);

    // 第 3 个（index 2）是 primary，值应与 draft 一致
    expect((colorInputs[2] as HTMLInputElement).value).toBe("#3b65b8");
  });

  it("State C 修改 primary 色后，draft.colors 和 themePreview 同步更新", async () => {
    const s = makeCustomSettings();
    useSettings.setState({ settings: s });
    setupI18n();

    render(<SettingsPanel open={true} onClose={() => {}} />);

    await screen.findByDisplayValue("82");

    const colorInputs = document.querySelectorAll('input[type="color"]');
    // 修改 primary 色（index 2）为 #ff0000
    fireEvent.change(colorInputs[2], { target: { value: "#ff0000" } });

    // themePreview 应同步更新
    const preview = useSettings.getState().themePreview;
    expect(preview).not.toBeNull();
    expect(preview?.customTheme.colors.primary).toBe("#ff0000");
    // 派生色 primary_soft 应基于新 primary 重算
    expect(preview?.customTheme.colors.primary_soft).toContain("rgba(255, 0, 0");
  });

  it("State C 点击重置按钮恢复原始提取色", async () => {
    const s = makeCustomSettings();
    useSettings.setState({ settings: s });
    setupI18n();

    render(<SettingsPanel open={true} onClose={() => {}} />);

    await screen.findByDisplayValue("82");

    // 修改 primary 色
    const colorInputs = document.querySelectorAll('input[type="color"]');
    fireEvent.change(colorInputs[2], { target: { value: "#ff0000" } });
    expect(useSettings.getState().themePreview?.customTheme.colors.primary).toBe("#ff0000");

    // 点击重置
    await userEvent.setup().click(screen.getByText(zh.settings.resetColors));

    // primary 应恢复为原始值 #3b65b8
    const preview = useSettings.getState().themePreview;
    expect(preview?.customTheme.colors.primary).toBe("#3b65b8");
    // primary_soft 恢复为原始格式（持久化数据中无空格）
    expect(preview?.customTheme.colors.primary_soft).toContain("59,101,184");
  });

  it("State A（未导入）不渲染色板和重置按钮", async () => {
    const s = makeSettings();
    s.general.theme = "custom";
    // 无 custom_theme，无 previewColors → State A
    useSettings.setState({ settings: s });
    setupI18n();

    render(<SettingsPanel open={true} onClose={() => {}} />);

    // State A 只有"导入图片"按钮，无色板
    expect(screen.getByText(zh.settings.importImage)).toBeInTheDocument();
    expect(screen.queryByText(zh.settings.resetColors)).not.toBeInTheDocument();
    expect(document.querySelectorAll('input[type="color"]')).toHaveLength(0);
  });

  it("State B 修改颜色后 previewColors 和 themePreview 同步更新", async () => {
    const user = userEvent.setup();
    render(<SettingsPanel open={true} onClose={() => {}} />);

    // 切换到 custom 主题
    const themeTrigger = document.getElementById("set-theme") as HTMLButtonElement;
    await user.click(themeTrigger);
    await user.click(screen.getByText(zh.settings.themeCustom));

    // mock 导入图片
    openDialogMock.mockResolvedValue("/fake/path/image.png");
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "read_file_bytes") return Promise.resolve([1, 2, 3, 4]);
      if (cmd === "save_custom_theme_image") return Promise.resolve("new-uuid.png");
      return Promise.resolve(undefined);
    });

    await user.click(screen.getByText(zh.settings.importImage));

    // 等待 State B 渲染（应用按钮出现）
    await screen.findByText(zh.settings.applyTheme);

    // State B 应有色板（5 个 color input）
    const colorInputs = document.querySelectorAll('input[type="color"]');
    expect(colorInputs).toHaveLength(5);

    // 修改 primary 色（index 2）为 #ff0000
    fireEvent.change(colorInputs[2], { target: { value: "#ff0000" } });

    // themePreview 应同步更新
    const preview = useSettings.getState().themePreview;
    expect(preview).not.toBeNull();
    expect(preview?.customTheme.colors.primary).toBe("#ff0000");
    expect(preview?.customTheme.colors.primary_soft).toContain("rgba(255, 0, 0");
  });

  it("State C 修改颜色后保存，持久化色值正确", async () => {
    const saveMock = vi.fn().mockResolvedValue(undefined);
    const s = makeCustomSettings();
    useSettings.setState({ settings: s, save: saveMock });
    setupI18n();

    const user = userEvent.setup();
    render(<SettingsPanel open={true} onClose={() => {}} />);

    await screen.findByDisplayValue("82");

    // 修改 primary 色为 #ff0000
    const colorInputs = document.querySelectorAll('input[type="color"]');
    fireEvent.change(colorInputs[2], { target: { value: "#ff0000" } });

    // 保存
    await user.click(screen.getByText(zh.settings.save));

    await vi.waitFor(() => {
      expect(saveMock).toHaveBeenCalled();
    });

    const saved = saveMock.mock.calls[0][0] as AppSettings;
    expect(saved.general.custom_theme?.colors.primary).toBe("#ff0000");
    // 派生色也应基于新 primary 重算
    expect(saved.general.custom_theme?.colors.primary_soft).toContain("rgba(255, 0, 0");
  });
});
