const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config')
const path = require('path')

const config = {
  watchFolders: [
    path.resolve(__dirname, '../../node_modules'),
  ],
  resolver: {
    nodeModulesPaths: [
      path.resolve(__dirname, 'node_modules'),
      path.resolve(__dirname, '../../node_modules'),
    ],
    // RN 0.86 / metro 0.84 把 unstable_enablePackageExports 默认翻成 true，
    // 导致 zustand 的 exports 走 "import" → esm/*.mjs（含 import.meta.env），
    // Hermes/hermesc 不支持 import.meta，createBundle 直接报错。
    // 关闭 exports 解析 = 回到 0.76 时代（metro 0.81 默认 false）的 main 字段
    // 语义，整棵依赖树解析行为保持升级前一致；后续依赖明确需要 exports 时再单独开。
    unstable_enablePackageExports: false,
  },
}

module.exports = mergeConfig(getDefaultConfig(__dirname), config)
