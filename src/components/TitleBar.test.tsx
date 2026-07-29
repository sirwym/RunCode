import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TitleBar from "./TitleBar";
import { zh } from "../locales/zh";

// mock useI18n
vi.mock("../hooks/useI18n", () => ({
  useI18n: (selector: (s: unknown) => unknown) =>
    selector({
      t: (key: string) => {
        const parts = key.split(".");
        let cur: unknown = zh;
        for (const p of parts) {
          if (cur && typeof cur === "object" && p in cur) {
            cur = (cur as Record<string, unknown>)[p];
          } else {
            return key;
          }
        }
        return typeof cur === "string" ? cur : key;
      },
    }),
}));

function makeHandlers() {
  return {
    settings: vi.fn(),
    file_new: vi.fn(),
    file_open: vi.fn(),
    file_save: vi.fn(),
    file_save_as: vi.fn(),
    file_recent: vi.fn(),
    file_close: vi.fn(),
    file_close_all: vi.fn(),
    edit_undo: vi.fn(),
    edit_redo: vi.fn(),
    edit_cut: vi.fn(),
    edit_copy: vi.fn(),
    edit_paste: vi.fn(),
    edit_select_all: vi.fn(),
    edit_format: vi.fn(),
    find: vi.fn(),
    find_next: vi.fn(),
    find_prev: vi.fn(),
    replace: vi.fn(),
    goto_line: vi.fn(),
    set_layout: vi.fn(),
    toggle_auto_hide: vi.fn(),
    font_inc: vi.fn(),
    font_dec: vi.fn(),
    font_reset: vi.fn(),
    toggle_panel: vi.fn(),
    toggle_devtools: vi.fn(),
    about: vi.fn(),
    help: vi.fn(),
  };
}

/** 统计当前 aria-expanded="true" 的菜单触发器数量 */
function countExpandedTriggers(): number {
  return screen
    .getAllByRole("button")
    .filter(
      (btn) =>
        btn.getAttribute("aria-expanded") === "true" &&
        btn.className.includes("titlebar-menu-trigger"),
    ).length;
}

/** 获取指定菜单名的触发器按钮 */
function trigger(name: string): HTMLElement {
  return screen.getByRole("button", { name });
}

describe("TitleBar", () => {
  let handlers: ReturnType<typeof makeHandlers>;

  beforeEach(() => {
    handlers = makeHandlers();
  });

  it("渲染 4 个顶级菜单触发器", () => {
    render(
      <TitleBar menuHandlers={handlers} layout="horizontal" autoHide={false} />,
    );
    expect(screen.getByText("文件")).toBeTruthy();
    expect(screen.getByText("编辑")).toBeTruthy();
    expect(screen.getByText("视图")).toBeTruthy();
    expect(screen.getByText("帮助")).toBeTruthy();
  });

  it("渲染居中标题 RunCode", () => {
    render(
      <TitleBar menuHandlers={handlers} layout="horizontal" autoHide={false} />,
    );
    const title = screen.getByText("RunCode");
    expect(title).toBeTruthy();
    expect(title.className).toContain("titlebar-title");
  });

  it("点击文件菜单打开下拉并触发新建", async () => {
    const user = userEvent.setup();
    render(
      <TitleBar menuHandlers={handlers} layout="horizontal" autoHide={false} />,
    );
    await user.click(screen.getByText("文件"));
    expect(screen.getByText("新建")).toBeTruthy();
    await user.click(screen.getByText("新建"));
    expect(handlers.file_new).toHaveBeenCalled();
  });

  it("点击帮助菜单打开下拉并触发设置", async () => {
    const user = userEvent.setup();
    render(
      <TitleBar menuHandlers={handlers} layout="horizontal" autoHide={false} />,
    );
    await user.click(screen.getByText("帮助"));
    expect(screen.getByText("设置…")).toBeTruthy();
    await user.click(screen.getByText("设置…"));
    expect(handlers.settings).toHaveBeenCalled();
  });

  it("点击编辑菜单打开下拉并触发格式化", async () => {
    const user = userEvent.setup();
    render(
      <TitleBar menuHandlers={handlers} layout="horizontal" autoHide={false} />,
    );
    await user.click(screen.getByText("编辑"));
    expect(screen.getByText("格式化")).toBeTruthy();
    await user.click(screen.getByText("格式化"));
    expect(handlers.edit_format).toHaveBeenCalled();
  });

  // ============ 菜单互斥切换回归测试 ============

  it("点击文件后文件 trigger 的 aria-expanded 为 true 且菜单内容存在", async () => {
    const user = userEvent.setup();
    render(
      <TitleBar menuHandlers={handlers} layout="horizontal" autoHide={false} />,
    );
    await user.click(trigger("文件"));

    expect(trigger("文件").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("新建")).toBeTruthy();
    expect(countExpandedTriggers()).toBe(1);
  });

  it("文件菜单打开时单击编辑，文件关闭编辑打开，同时只有一个菜单", async () => {
    const user = userEvent.setup();
    render(
      <TitleBar menuHandlers={handlers} layout="horizontal" autoHide={false} />,
    );
    await user.click(trigger("文件"));
    expect(screen.getByText("新建")).toBeTruthy();

    await user.click(trigger("编辑"));

    expect(trigger("文件").getAttribute("aria-expanded")).toBe("false");
    expect(trigger("编辑").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("格式化")).toBeTruthy();
    expect(countExpandedTriggers()).toBe(1);
  });

  it("依次点击文件、编辑、视图、帮助，每步只有一个 trigger 展开", async () => {
    const user = userEvent.setup();
    render(
      <TitleBar menuHandlers={handlers} layout="horizontal" autoHide={false} />,
    );

    await user.click(trigger("文件"));
    expect(trigger("文件").getAttribute("aria-expanded")).toBe("true");
    expect(countExpandedTriggers()).toBe(1);

    await user.click(trigger("编辑"));
    expect(trigger("编辑").getAttribute("aria-expanded")).toBe("true");
    expect(trigger("文件").getAttribute("aria-expanded")).toBe("false");
    expect(countExpandedTriggers()).toBe(1);

    await user.click(trigger("视图"));
    expect(trigger("视图").getAttribute("aria-expanded")).toBe("true");
    expect(trigger("编辑").getAttribute("aria-expanded")).toBe("false");
    expect(countExpandedTriggers()).toBe(1);

    await user.click(trigger("帮助"));
    expect(trigger("帮助").getAttribute("aria-expanded")).toBe("true");
    expect(trigger("视图").getAttribute("aria-expanded")).toBe("false");
    expect(countExpandedTriggers()).toBe(1);
  });

  it("点击菜单以外区域后当前菜单关闭", async () => {
    const user = userEvent.setup();
    render(
      <TitleBar menuHandlers={handlers} layout="horizontal" autoHide={false} />,
    );
    await user.click(trigger("文件"));
    expect(trigger("文件").getAttribute("aria-expanded")).toBe("true");

    // 点击标题栏空白区域（RunCode 标题文字）
    await user.click(screen.getByText("RunCode"));

    expect(trigger("文件").getAttribute("aria-expanded")).toBe("false");
    expect(countExpandedTriggers()).toBe(0);
  });

  it("再次点击已打开的 trigger 可以关闭该菜单", async () => {
    const user = userEvent.setup();
    render(
      <TitleBar menuHandlers={handlers} layout="horizontal" autoHide={false} />,
    );
    await user.click(trigger("文件"));
    expect(trigger("文件").getAttribute("aria-expanded")).toBe("true");

    await user.click(trigger("文件"));

    expect(trigger("文件").getAttribute("aria-expanded")).toBe("false");
    expect(countExpandedTriggers()).toBe(0);
  });

  // ============ 编辑菜单新增项目测试 ============

  it("编辑菜单渲染撤销、重做、剪切、复制、粘贴、全选", async () => {
    const user = userEvent.setup();
    render(
      <TitleBar menuHandlers={handlers} layout="horizontal" autoHide={false} />,
    );
    await user.click(trigger("编辑"));
    expect(screen.getByText("撤销")).toBeTruthy();
    expect(screen.getByText("重做")).toBeTruthy();
    expect(screen.getByText("剪切")).toBeTruthy();
    expect(screen.getByText("复制")).toBeTruthy();
    expect(screen.getByText("粘贴")).toBeTruthy();
    expect(screen.getByText("全选")).toBeTruthy();
  });

  it("点击复制触发 edit_copy handler", async () => {
    const user = userEvent.setup();
    render(
      <TitleBar menuHandlers={handlers} layout="horizontal" autoHide={false} />,
    );
    await user.click(trigger("编辑"));
    await user.click(screen.getByText("复制"));
    expect(handlers.edit_copy).toHaveBeenCalled();
  });

  it("点击粘贴触发 edit_paste handler", async () => {
    const user = userEvent.setup();
    render(
      <TitleBar menuHandlers={handlers} layout="horizontal" autoHide={false} />,
    );
    await user.click(trigger("编辑"));
    await user.click(screen.getByText("粘贴"));
    expect(handlers.edit_paste).toHaveBeenCalled();
  });

  // ============ 布局方向子菜单测试 ============

  it("视图布局方向：点击上下分栏传入 vertical", async () => {
    const user = userEvent.setup();
    render(
      <TitleBar menuHandlers={handlers} layout="horizontal" autoHide={false} />,
    );
    await user.click(trigger("视图"));
    await user.hover(screen.getByText("布局方向"));
    const verticalItem = await screen.findByRole("menuitemradio", { name: "上下分栏" });
    // Radix DropdownMenuRadioItem 通过 pointerUp 触发选择，
    // JSDOM 中 user.click 无法在 Sub Portal 内正确触发 pointerUp 链
    fireEvent.pointerUp(verticalItem, { button: 0 });
    expect(handlers.set_layout).toHaveBeenCalledWith("vertical");
  });

  it("视图布局方向：点击左右分栏传入 horizontal", async () => {
    const user = userEvent.setup();
    render(
      <TitleBar menuHandlers={handlers} layout="vertical" autoHide={false} />,
    );
    await user.click(trigger("视图"));
    await user.hover(screen.getByText("布局方向"));
    const horizontalItem = await screen.findByRole("menuitemradio", { name: "左右分栏" });
    fireEvent.pointerUp(horizontalItem, { button: 0 });
    expect(handlers.set_layout).toHaveBeenCalledWith("horizontal");
  });

  // ============ 帮助菜单测试 ============

  it("帮助菜单渲染切换开发人员工具、关于 RunCode、设置", async () => {
    const user = userEvent.setup();
    render(
      <TitleBar menuHandlers={handlers} layout="horizontal" autoHide={false} />,
    );
    await user.click(trigger("帮助"));
    expect(screen.getByText("切换开发人员工具")).toBeTruthy();
    expect(screen.getByText("关于 RunCode")).toBeTruthy();
    expect(screen.getByText("设置…")).toBeTruthy();
  });

  it("点击切换开发人员工具触发 toggle_devtools handler", async () => {
    const user = userEvent.setup();
    render(
      <TitleBar menuHandlers={handlers} layout="horizontal" autoHide={false} />,
    );
    await user.click(trigger("帮助"));
    await user.click(screen.getByText("切换开发人员工具"));
    expect(handlers.toggle_devtools).toHaveBeenCalled();
  });

  it("点击关于 RunCode 触发 about handler", async () => {
    const user = userEvent.setup();
    render(
      <TitleBar menuHandlers={handlers} layout="horizontal" autoHide={false} />,
    );
    await user.click(trigger("帮助"));
    await user.click(screen.getByText("关于 RunCode"));
    expect(handlers.about).toHaveBeenCalled();
  });
});
