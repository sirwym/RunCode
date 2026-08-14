import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ConfirmCloseDialog from "./ConfirmCloseDialog";
import { useI18n } from "../hooks/useI18n";

beforeEach(() => {
  // 真实 i18n store（zh），t 会替换 {name}/{count} 占位
  useI18n.getState().setLocale("zh");
});

describe("ConfirmCloseDialog", () => {
  it("open=false 时不渲染", () => {
    render(
      <ConfirmCloseDialog
        open={false}
        mode="single"
        fileName="a.cpp"
        onResult={() => {}}
      />
    );
    expect(screen.queryByText("未保存的更改")).toBeNull();
  });

  it("single 模式渲染标题、正文（含文件名）与三按钮", () => {
    render(
      <ConfirmCloseDialog
        open
        mode="single"
        fileName="a.cpp"
        onResult={() => {}}
      />
    );
    expect(screen.getByText("未保存的更改")).toBeTruthy();
    expect(screen.getByText(/a\.cpp/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "取消" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "不保存" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "保存" })).toBeTruthy();
  });

  it("all 模式正文含数量", () => {
    render(
      <ConfirmCloseDialog open mode="all" count={3} onResult={() => {}} />
    );
    expect(screen.getByText(/3/)).toBeTruthy();
  });

  it("点取消 → onResult(cancel)", () => {
    const onResult = vi.fn();
    render(
      <ConfirmCloseDialog
        open
        mode="single"
        fileName="a"
        onResult={onResult}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onResult).toHaveBeenCalledWith("cancel");
  });

  it("点不保存 → onResult(discard)", () => {
    const onResult = vi.fn();
    render(
      <ConfirmCloseDialog
        open
        mode="single"
        fileName="a"
        onResult={onResult}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "不保存" }));
    expect(onResult).toHaveBeenCalledWith("discard");
  });

  it("点保存 → onResult(save)", () => {
    const onResult = vi.fn();
    render(
      <ConfirmCloseDialog
        open
        mode="single"
        fileName="a"
        onResult={onResult}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onResult).toHaveBeenCalledWith("save");
  });
});
