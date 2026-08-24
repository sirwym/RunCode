import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import DiffDialog from "./DiffDialog";
import type { DiffDialogProps } from "./DiffDialog";
import { useI18n } from "../hooks/useI18n";

beforeEach(() => {
  // 真实 i18n store（zh）
  useI18n.getState().setLocale("zh");
});

function renderDialog(overrides: Partial<DiffDialogProps> = {}) {
  const props: DiffDialogProps = {
    open: true,
    onClose: () => {},
    caseName: "case-1",
    expectedFull: "1\n2\n3\n",
    actual: "1\n2\n3\n",
    truncated: false,
    strict: false,
    loading: false,
    error: null,
    ...overrides,
  };
  return render(<DiffDialog {...props} />);
}

describe("DiffDialog", () => {
  it("实际与期望均为空 → 显示“完全一致”文案而非“加载中”", () => {
    renderDialog({ actual: "", expectedFull: "" });
    // 左右两栏各渲染一次空提示
    expect(screen.getAllByText("实际输出与期望完全一致，无差异").length).toBe(2);
    expect(screen.queryByText("加载期望输出中…")).toBeNull();
  });

  it("实际与期望逐行一致 → 渲染相同行，不显示空提示", () => {
    renderDialog({
      expectedFull: "alpha\nbeta\ngamma\n",
      actual: "alpha\nbeta\ngamma\n",
    });
    // "beta" 内容出现在左右两栏，无空提示
    expect(screen.getAllByText("beta").length).toBe(2);
    expect(screen.queryByText("实际输出与期望完全一致，无差异")).toBeNull();
  });

  it("存在差异 → 不显示空提示", () => {
    renderDialog({ actual: "1\nX\n3\n" });
    expect(screen.queryByText("实际输出与期望完全一致，无差异")).toBeNull();
  });

  it("loading=true → 显示加载提示、主体不渲染", () => {
    renderDialog({ loading: true });
    expect(screen.getByText("加载期望输出中…")).toBeTruthy();
    expect(screen.queryByText("实际输出与期望完全一致，无差异")).toBeNull();
  });

  it("error 非空 → 显示加载失败提示、主体不渲染", () => {
    renderDialog({ error: "boom" });
    expect(screen.getByText("加载失败：boom")).toBeTruthy();
    expect(screen.queryByText("实际输出与期望完全一致，无差异")).toBeNull();
  });
});
