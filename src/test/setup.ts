import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Radix UI Select 在 jsdom 下需要 Pointer Capture API
// jsdom 未实现这组 API，导致 Radix Select 下拉项点击时抛异常
if (typeof HTMLElement !== "undefined") {
  HTMLElement.prototype.hasPointerCapture =
    HTMLElement.prototype.hasPointerCapture || (() => false);
  HTMLElement.prototype.setPointerCapture =
    HTMLElement.prototype.setPointerCapture || (() => {});
  HTMLElement.prototype.releasePointerCapture =
    HTMLElement.prototype.releasePointerCapture || (() => {});
}

// jsdom 未实现 scrollIntoView / scrollTo，Radix Select 内容渲染时调用会报错
if (typeof Element !== "undefined") {
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || (() => {});
}
if (typeof window !== "undefined") {
  window.scrollTo = window.scrollTo || (() => {});
}

// 每个测试后清理 DOM，避免组件状态泄漏
afterEach(() => {
  cleanup();
});
