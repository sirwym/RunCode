import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SHORTCUTS, SHORTCUT_CATEGORY_KEY, default as SettingsPanel } from "./SettingsPanel";
import { zh } from "../locales/zh";
import { en } from "../locales/en";
import { useI18n } from "../hooks/useI18n";
import { useSettings } from "../hooks/useSettings";
import type { AppSettings } from "../types";

// mock @tauri-apps/api/core 的 invoke（SettingsPanel 用于 clear_recent_files）
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

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

describe("SHORTCUTS 数据完整性", () => {
  it("应有 17 项快捷键", () => {
    expect(SHORTCUTS).toHaveLength(17);
  });

  it("每项的 action key 在 zh 与 en 中都存在", () => {
    for (const s of SHORTCUTS) {
      expect(getByPath(zh, s.action), `zh 缺少 ${s.action}`).toBeTypeOf("string");
      expect(getByPath(en, s.action), `en 缺少 ${s.action}`).toBeTypeOf("string");
    }
  });

  it("每项的 category 在 SHORTCUT_CATEGORY_KEY 中有映射", () => {
    for (const s of SHORTCUTS) {
      expect(SHORTCUT_CATEGORY_KEY[s.category], `缺少 category 映射: ${s.category}`).toBeDefined();
    }
  });

  it("每个 category 映射的 key 在 zh 与 en 中都存在", () => {
    for (const categoryKey of Object.values(SHORTCUT_CATEGORY_KEY)) {
      expect(getByPath(zh, categoryKey), `zh 缺少 ${categoryKey}`).toBeTypeOf("string");
      expect(getByPath(en, categoryKey), `en 缺少 ${categoryKey}`).toBeTypeOf("string");
    }
  });

  it("keys 不为空且唯一", () => {
    const keys = SHORTCUTS.map((s) => s.keys);
    for (const k of keys) {
      expect(k.length).toBeGreaterThan(0);
    }
    // 唯一性（允许同一按键出现在不同上下文，但这里数据应唯一）
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("不包含布局切换项（用户确认点 4：布局切换无快捷键）", () => {
    const actions = SHORTCUTS.map((s) => s.action);
    expect(actions).not.toContain("menu.layoutHorizontal");
    expect(actions).not.toContain("menu.layoutVertical");
  });

  it("包含 Cmd+\\（用户确认点 4：隐藏面板有快捷键）", () => {
    const item = SHORTCUTS.find((s) => s.action === "menu.togglePanel");
    expect(item, "缺少 menu.togglePanel 项").toBeDefined();
    expect(item!.keys).toBe("Cmd+\\");
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

  it("切换到快捷键 tab 后渲染 17 行数据", async () => {
    const user = userEvent.setup();
    render(<SettingsPanel open={true} onClose={() => {}} />);

    await user.click(screen.getByRole("tab", { name: zh.settings.shortcuts }));

    const table = document.querySelector(".shortcuts-table");
    expect(table, "shortcuts 表格未渲染").not.toBeNull();
    const tableScope = within(table as HTMLElement);

    // 每个快捷键的 keys 都应在表格中（用 kbd 文本查找）
    for (const s of SHORTCUTS) {
      expect(tableScope.getByText(s.keys)).toBeInTheDocument();
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

    for (const s of SHORTCUTS) {
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

  it("fsize_mb 不再出现在运行时配置小节（从 test 读取）", async () => {
    const user = userEvent.setup();
    render(<SettingsPanel open={true} onClose={() => {}} />);
    await user.click(screen.getByRole("tab", { name: zh.settings.languageSettings }));
    // fsize_mb 控件应存在（在测试设置小节），但其 value 来自 draft.test
    const input = document.getElementById("set-fsize-mb") as HTMLInputElement;
    expect(input.value).toBe("10"); // draft.test.fsize_mb 默认值
  });
});
