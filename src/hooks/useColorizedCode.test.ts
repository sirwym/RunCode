import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import * as monaco from "monaco-editor";
import { useColorizedCode } from "./useColorizedCode";

// vitest.config.ts 的 alias 已将 monaco-editor 指向 mock 文件
// 这里 spy mock 文件的 colorize 以便每个用例自定义返回值
const colorizeSpy = vi.spyOn(monaco.editor, "colorize");

beforeEach(() => {
  colorizeSpy.mockReset();
});

describe("useColorizedCode", () => {
  it("基本调用：传入 code 后异步返回 colorize 结果", async () => {
    colorizeSpy.mockResolvedValue('<span class="tok">int</span> a;');
    const { result } = renderHook(() => useColorizedCode("int a;", "dark"));
    await waitFor(() => {
      expect(result.current).toContain("span");
    });
    expect(colorizeSpy).toHaveBeenCalledWith("int a;", "cpp", { tabSize: 4 });
  });

  it("themeKey 变化时重新调用 colorize", async () => {
    colorizeSpy
      .mockResolvedValueOnce('<span class="tok">dark</span>')
      .mockResolvedValueOnce('<span class="tok">light</span>');
    const { result, rerender } = renderHook(
      ({ themeKey }) => useColorizedCode("int a;", themeKey),
      { initialProps: { themeKey: "dark" } },
    );
    await waitFor(() => expect(result.current).toContain("dark"));
    rerender({ themeKey: "light" });
    await waitFor(() => expect(result.current).toContain("light"));
    expect(colorizeSpy).toHaveBeenCalledTimes(2);
  });

  it("code 变化时重新调用 colorize", async () => {
    colorizeSpy
      .mockResolvedValueOnce('<span class="tok">a</span>')
      .mockResolvedValueOnce('<span class="tok">b</span>');
    const { result, rerender } = renderHook(
      ({ code }) => useColorizedCode(code, "dark"),
      { initialProps: { code: "int a;" } },
    );
    await waitFor(() => expect(result.current).toContain("a"));
    rerender({ code: "int b;" });
    await waitFor(() => expect(result.current).toContain("b"));
    expect(colorizeSpy).toHaveBeenCalledTimes(2);
  });

  it("colorize 失败时回退空字符串", async () => {
    colorizeSpy.mockRejectedValue(new Error("mock fail"));
    const { result } = renderHook(() => useColorizedCode("int a;", "dark"));
    await waitFor(() => {
      expect(result.current).toBe("");
    });
  });

  it("卸载后不再 setState（无 act 警告）", async () => {
    let resolveLater: (v: string) => void = () => {};
    colorizeSpy.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveLater = resolve;
      }),
    );
    const { result, unmount } = renderHook(() =>
      useColorizedCode("int a;", "dark"),
    );
    expect(result.current).toBe("");
    unmount();
    // 卸载后再 resolve，不应触发 setState 警告
    act(() => {
      resolveLater('<span class="tok">int</span>');
    });
    // result.current 仍为空（已被丢弃）
    expect(result.current).toBe("");
  });

  it("竞态保护：依赖变化时丢弃旧 Promise 结果", async () => {
    let resolveFirst: (v: string) => void = () => {};
    let resolveSecond: (v: string) => void = () => {};
    colorizeSpy
      .mockReturnValueOnce(
        new Promise<string>((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise<string>((resolve) => {
          resolveSecond = resolve;
        }),
      );
    const { result, rerender } = renderHook(
      ({ themeKey }) => useColorizedCode("int a;", themeKey),
      { initialProps: { themeKey: "dark" } },
    );
    // 切换到 light，触发第二次 colorize（第一次尚未 resolve）
    rerender({ themeKey: "light" });
    // 先 resolve 第一次（应被丢弃）
    act(() => resolveFirst('<span class="tok">DARK_STALE</span>'));
    expect(result.current).toBe("");
    // 再 resolve 第二次（应生效）
    act(() => resolveSecond('<span class="tok">LIGHT_FRESH</span>'));
    await waitFor(() => expect(result.current).toContain("LIGHT_FRESH"));
    expect(result.current).not.toContain("DARK_STALE");
  });
});
