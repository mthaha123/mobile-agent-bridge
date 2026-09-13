#!/usr/bin/env node
/**
 * E2E 端口配置入口 —— 统一从 `scripts/ports.mjs` 再导出（保持向后兼容的导入路径）。
 *
 * 端口段定义、生产守卫、测试端口的单一事实来源见 `scripts/ports.mjs`。
 */
export * from "../ports.mjs"
