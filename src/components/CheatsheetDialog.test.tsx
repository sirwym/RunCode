import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import CheatsheetDialog from "./CheatsheetDialog";
import { useI18n } from "../hooks/useI18n";
import { CHEATSHEET_ENTRIES } from "../data/cheatsheet";

// mock clipboard（jsdom 不支持 navigator.clipboard）
const writeTextMock = vi.fn().mockResolvedValue(undefined);
beforeEach(() => {
  writeTextMock.mockClear();
  Object.assign(navigator, {
    clipboard: { writeText: writeTextMock },
  });
  // 重置 i18n 为 zh（默认）
  useI18n.getState().setLocale("zh");
});

describe("CheatsheetDialog", () => {
  it("open=false 时不渲染", () => {
    render(<CheatsheetDialog open={false} onClose={() => {}} />);
    expect(screen.queryByText("C++ 速查表")).toBeNull();
  });

  it("open=true 时渲染标题和搜索框", () => {
    render(<CheatsheetDialog open={true} onClose={() => {}} />);
    expect(screen.getByText("C++ 速查表")).toBeTruthy();
    expect(
      screen.getByPlaceholderText("搜索语法、STL、算法……"),
    ).toBeTruthy();
  });

  it("空搜索显示 6 个分类小标题（按分类分组）", () => {
    render(<CheatsheetDialog open={true} onClose={() => {}} />);
    // 分类小标题用 .cheatsheet-group-title class，区别于 chip
    const groupTitles = document.querySelectorAll(".cheatsheet-group-title");
    expect(groupTitles.length).toBe(6);
    const texts = Array.from(groupTitles).map((el) => el.textContent);
    expect(texts).toEqual([
      "输入输出",
      "语法",
      "STL 容器/算法",
      "常用算法",
      "动态规划",
      "图论",
    ]);
  });

  it("输入 printf 时至少命中 printf 条目", () => {
    render(<CheatsheetDialog open={true} onClose={() => {}} />);
    const input = screen.getByPlaceholderText("搜索语法、STL、算法……");
    fireEvent.change(input, { target: { value: "printf" } });
    // printf 的 name 在文档中
    const names = screen.getAllByText("printf");
    expect(names.length).toBeGreaterThan(0);
  });

  it("点击 chip 过滤分类（动态规划）", () => {
    render(<CheatsheetDialog open={true} onClose={() => {}} />);
    // chip 在 .cheatsheet-categories 容器内，区别于分组小标题
    const categoriesEl = document.querySelector(".cheatsheet-categories");
    expect(categoriesEl).toBeTruthy();
    const dpChip = within(categoriesEl as HTMLElement).getByText("动态规划");
    fireEvent.click(dpChip);
    // 输入输出分类的 entry name（如 printf）应消失
    expect(screen.queryByText("printf")).toBeNull();
  });

  it("无匹配显示空状态文案", () => {
    render(<CheatsheetDialog open={true} onClose={() => {}} />);
    const input = screen.getByPlaceholderText("搜索语法、STL、算法……");
    fireEvent.change(input, { target: { value: "xyz123_not_exists" } });
    expect(screen.getByText("没有匹配的条目")).toBeTruthy();
  });

  it("点击复制按钮调用 clipboard.writeText", () => {
    render(<CheatsheetDialog open={true} onClose={() => {}} />);
    // 每条都有复制按钮，取第一个
    const copyBtns = screen.getAllByTitle("复制");
    expect(copyBtns.length).toBeGreaterThan(0);
    fireEvent.click(copyBtns[0]);
    expect(writeTextMock).toHaveBeenCalledTimes(1);
    // 写入的内容应是第一条 entry 的所有 snippet 拼接
    const firstEntry = CHEATSHEET_ENTRIES[0];
    const expectedText = firstEntry.snippets.map((s) => s.code).join("\n");
    expect(writeTextMock).toHaveBeenCalledWith(expectedText);
  });

  it("open 从 true 变 false 再变 true 时重置搜索", () => {
    const { rerender } = render(
      <CheatsheetDialog open={true} onClose={() => {}} />,
    );
    const input = screen.getByPlaceholderText(
      "搜索语法、STL、算法……",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "printf" } });
    expect(input.value).toBe("printf");

    // 关闭
    rerender(<CheatsheetDialog open={false} onClose={() => {}} />);
    // 重新打开
    rerender(<CheatsheetDialog open={true} onClose={() => {}} />);
    const inputAfter = screen.getByPlaceholderText(
      "搜索语法、STL、算法……",
    ) as HTMLInputElement;
    expect(inputAfter.value).toBe("");
  });

  it("snippet 最终被 colorize 渲染为带 span 的 HTML", async () => {
    render(<CheatsheetDialog open={true} onClose={() => {}} />);
    // colorize 是异步的，等待 pre 内出现 span
    await waitFor(() => {
      const codeEls = document.querySelectorAll(".cheatsheet-snippet-code");
      expect(codeEls.length).toBeGreaterThan(0);
      // 至少有一个 pre 内含 span（colorize 已完成）
      const hasSpan = Array.from(codeEls).some((el) =>
        el.innerHTML.includes("span"),
      );
      expect(hasSpan).toBe(true);
    });
  });

  it("搜索关键字时 name/title/summary 中出现 <mark> 高亮", () => {
    render(<CheatsheetDialog open={true} onClose={() => {}} />);
    const input = screen.getByPlaceholderText("搜索语法、STL、算法……");
    fireEvent.change(input, { target: { value: "string" } });
    // 命中条目的 name/title/summary 中应出现 <mark class="cheatsheet-hl">
    const marks = document.querySelectorAll("mark.cheatsheet-hl");
    expect(marks.length).toBeGreaterThan(0);
  });

  it("空 query 时不存在 <mark> 高亮元素", () => {
    render(<CheatsheetDialog open={true} onClose={() => {}} />);
    const marks = document.querySelectorAll("mark.cheatsheet-hl");
    expect(marks.length).toBe(0);
  });
});
