import { describe, it, expect, beforeEach, vi } from "vitest";
import { useTestSuite } from "./useTestSuite";
import type { CasePreview, TestSuiteManifest } from "../types";

// mock @tauri-apps/api/core 的 invoke
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => invokeMock(cmd, args),
}));

function makePreview(overrides: Partial<CasePreview> = {}): CasePreview {
  return {
    id: "case-1",
    name: "样例1",
    input_size: 1,
    expected_size: 1,
    strict: false,
    input_preview: "1",
    expected_preview: "2",
    is_large: false,
    ...overrides,
  };
}

function makeManifest(overrides: Partial<TestSuiteManifest> = {}): TestSuiteManifest {
  return {
    suite_id: "suite-1",
    doc_path: null,
    cases: [],
    updated_at: 0,
    schema_version: 2,
    ...overrides,
  };
}

describe("useTestSuite refreshCase", () => {
  beforeEach(() => {
    useTestSuite.setState({
      suiteId: "suite-1",
      manifest: makeManifest(),
      previews: [makePreview()],
      loading: false,
    });
    invokeMock.mockReset();
  });

  it("成功后只更新对应 case 的 preview，不影响其他 case", async () => {
    const preview1 = makePreview({ id: "case-1", input_preview: "old" });
    const preview2 = makePreview({ id: "case-2", name: "样例2", input_preview: "other" });
    useTestSuite.setState({ previews: [preview1, preview2] });

    const updated = makePreview({ id: "case-1", input_preview: "new" });
    invokeMock.mockResolvedValueOnce(updated);

    await useTestSuite.getState().refreshCase("case-1");

    const state = useTestSuite.getState();
    expect(state.previews).toHaveLength(2);
    expect(state.previews[0]).toEqual(updated);
    // case-2 不受影响
    expect(state.previews[1]).toEqual(preview2);
  });

  it("调用 get_case_preview 命令并传入正确参数", async () => {
    invokeMock.mockResolvedValueOnce(makePreview());

    await useTestSuite.getState().refreshCase("case-1");

    expect(invokeMock).toHaveBeenCalledWith("get_case_preview", {
      suiteId: "suite-1",
      caseId: "case-1",
    });
  });

  it("invoke 失败时不抛错（静默忽略，不阻塞用户编辑）", async () => {
    invokeMock.mockRejectedValueOnce(new Error("network"));

    await expect(
      useTestSuite.getState().refreshCase("case-1"),
    ).resolves.toBeUndefined();

    // previews 保持原值
    expect(useTestSuite.getState().previews[0].input_preview).toBe("1");
  });

  it("suiteId 为 null 时直接返回，不调用 invoke", async () => {
    useTestSuite.setState({ suiteId: null });
    invokeMock.mockReset();

    await useTestSuite.getState().refreshCase("case-1");

    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe("useTestSuite updateCase 单卡刷新", () => {
  beforeEach(() => {
    useTestSuite.setState({
      suiteId: "suite-1",
      manifest: makeManifest(),
      previews: [makePreview()],
      loading: false,
    });
    invokeMock.mockReset();
  });

  it("updateCase 成功后调用 refreshCase 而非全量 refresh", async () => {
    // update_test_case 返回空（前端不使用返回值）
    invokeMock.mockResolvedValueOnce(undefined);
    // get_case_preview 返回更新后的 preview
    const updated = makePreview({ input_preview: "new input" });
    invokeMock.mockResolvedValueOnce(updated);

    await useTestSuite.getState().updateCase("case-1", { input: "new input" });

    // 验证调用顺序：先 update_test_case，再 get_case_preview（单卡刷新）
    expect(invokeMock).toHaveBeenNthCalledWith(1, "update_test_case", {
      suiteId: "suite-1",
      caseId: "case-1",
      name: null,
      input: "new input",
      expected: null,
      strict: null,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "get_case_preview", {
      suiteId: "suite-1",
      caseId: "case-1",
    });
    // 不应调用 get_all_case_previews（全量 refresh）
    expect(invokeMock).not.toHaveBeenCalledWith(
      "get_all_case_previews",
      expect.anything(),
    );

    // preview 被更新
    expect(useTestSuite.getState().previews[0]).toEqual(updated);
  });

  it("updateCase 失败时不调用 refreshCase", async () => {
    invokeMock.mockRejectedValueOnce(new Error("总量超限"));

    await expect(
      useTestSuite.getState().updateCase("case-1", { input: "x" }),
    ).rejects.toThrow("总量超限");

    // 只调用了 update_test_case，没有调用 get_case_preview
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("update_test_case", expect.anything());
  });

  it("updateCase 只传 patch 中的字段，其余为 null", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    invokeMock.mockResolvedValueOnce(makePreview());

    await useTestSuite.getState().updateCase("case-1", { name: "新名字" });

    expect(invokeMock).toHaveBeenCalledWith("update_test_case", {
      suiteId: "suite-1",
      caseId: "case-1",
      name: "新名字",
      input: null,
      expected: null,
      strict: null,
    });
  });
});

describe("useTestSuite 选中状态", () => {
  beforeEach(() => {
    useTestSuite.setState({
      suiteId: "suite-1",
      manifest: makeManifest(),
      previews: [
        makePreview({ id: "case-1" }),
        makePreview({ id: "case-2", name: "样例2" }),
        makePreview({ id: "case-3", name: "样例3" }),
      ],
      deselectedBySuite: {},
      deselectedIds: [],
      loading: false,
    });
    invokeMock.mockReset();
  });

  it("初始状态全部选中", () => {
    expect(useTestSuite.getState().isAllSelected()).toBe(true);
    expect(useTestSuite.getState().getSelectedIds()).toEqual(["case-1", "case-2", "case-3"]);
  });

  it("toggleCaseSelection 切换单个", () => {
    useTestSuite.getState().toggleCaseSelection("case-2");
    expect(useTestSuite.getState().getSelectedIds()).toEqual(["case-1", "case-3"]);
    expect(useTestSuite.getState().isAllSelected()).toBe(false);

    // 再切回来
    useTestSuite.getState().toggleCaseSelection("case-2");
    expect(useTestSuite.getState().getSelectedIds()).toEqual(["case-1", "case-2", "case-3"]);
    expect(useTestSuite.getState().isAllSelected()).toBe(true);
  });

  it("selectAll 清空 deselectedIds", () => {
    useTestSuite.getState().toggleCaseSelection("case-1");
    useTestSuite.getState().selectAll();
    expect(useTestSuite.getState().deselectedIds).toEqual([]);
    expect(useTestSuite.getState().isAllSelected()).toBe(true);
  });

  it("deselectAll 把所有 case 加入 deselectedIds", () => {
    useTestSuite.getState().deselectAll();
    expect(useTestSuite.getState().deselectedIds).toEqual(["case-1", "case-2", "case-3"]);
    expect(useTestSuite.getState().isAllSelected()).toBe(false);
    expect(useTestSuite.getState().getSelectedIds()).toEqual([]);
  });

  it("全选 toggle：当前全选 → 全不选 → 全选", () => {
    // 模拟 TestCasesPanel.handleToggleAll
    const handleToggleAll = () => {
      if (useTestSuite.getState().isAllSelected()) {
        useTestSuite.getState().deselectAll();
      } else {
        useTestSuite.getState().selectAll();
      }
    };
    // 初始全选 → 点击 → 全不选
    handleToggleAll();
    expect(useTestSuite.getState().isAllSelected()).toBe(false);
    expect(useTestSuite.getState().getSelectedIds()).toEqual([]);
    // 全不选 → 点击 → 全选
    handleToggleAll();
    expect(useTestSuite.getState().isAllSelected()).toBe(true);
    expect(useTestSuite.getState().getSelectedIds()).toEqual(["case-1", "case-2", "case-3"]);
  });

  it("部分选中时点击全选 → 全选", () => {
    useTestSuite.getState().toggleCaseSelection("case-1");
    expect(useTestSuite.getState().isAllSelected()).toBe(false);
    // 部分选 → 点击 → 全选
    useTestSuite.getState().selectAll();
    expect(useTestSuite.getState().isAllSelected()).toBe(true);
  });

  it("per-tab 隔离：切到 suite-2 再切回 suite-1 保留状态", async () => {
    useTestSuite.getState().toggleCaseSelection("case-2");
    expect(useTestSuite.getState().deselectedIds).toEqual(["case-2"]);

    // 模拟切到 suite-2
    invokeMock.mockResolvedValueOnce(makeManifest({ suite_id: "suite-2" })); // load_test_suite
    invokeMock.mockResolvedValueOnce([makePreview({ id: "case-a" })]); // get_all_case_previews
    await useTestSuite.getState().setSuiteId("suite-2");
    // suite-2 首次访问，默认全选
    expect(useTestSuite.getState().deselectedIds).toEqual([]);
    expect(useTestSuite.getState().isAllSelected()).toBe(true);

    // 在 suite-2 取消 case-a
    useTestSuite.getState().toggleCaseSelection("case-a");
    expect(useTestSuite.getState().deselectedIds).toEqual(["case-a"]);

    // 切回 suite-1
    invokeMock.mockResolvedValueOnce(makeManifest());
    invokeMock.mockResolvedValueOnce([
      makePreview({ id: "case-1" }),
      makePreview({ id: "case-2", name: "样例2" }),
      makePreview({ id: "case-3", name: "样例3" }),
    ]);
    await useTestSuite.getState().setSuiteId("suite-1");
    // suite-1 保留之前的 case-2 取消选中
    expect(useTestSuite.getState().deselectedIds).toEqual(["case-2"]);
    // suite-2 的状态仍在缓存中
    expect(useTestSuite.getState().deselectedBySuite["suite-2"]).toEqual(["case-a"]);
  });

  it("新增用例自动选中（不在 deselectedIds 中）", () => {
    useTestSuite.getState().deselectAll();
    // 模拟 addCase 后 refresh 增加 case-4
    useTestSuite.setState({
      previews: [
        makePreview({ id: "case-1" }),
        makePreview({ id: "case-2", name: "样例2" }),
        makePreview({ id: "case-3", name: "样例3" }),
        makePreview({ id: "case-4", name: "样例4" }),
      ],
      // deselectedIds 仍是旧的三项，case-4 不在其中
    });
    expect(useTestSuite.getState().getSelectedIds()).toEqual(["case-4"]);
  });

  it("删除用例后 deselectedIds 残留无影响", () => {
    useTestSuite.getState().toggleCaseSelection("case-2");
    expect(useTestSuite.getState().deselectedIds).toEqual(["case-2"]);
    // 模拟 removeCase 后 refresh，previews 不再含 case-2
    useTestSuite.setState({
      previews: [
        makePreview({ id: "case-1" }),
        makePreview({ id: "case-3", name: "样例3" }),
      ],
      // deselectedIds 仍含 case-2（未主动清理）
    });
    // getSelectedIds 基于 previews 过滤，case-2 残留无害
    expect(useTestSuite.getState().getSelectedIds()).toEqual(["case-1", "case-3"]);
  });

  it("suiteId 为 null 时选中操作静默无效", () => {
    useTestSuite.setState({ suiteId: null });
    // 不应抛错，也不应改状态
    useTestSuite.getState().toggleCaseSelection("case-1");
    useTestSuite.getState().selectAll();
    useTestSuite.getState().deselectAll();
    expect(useTestSuite.getState().deselectedIds).toEqual([]);
  });
});
