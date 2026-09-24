/**
 * Mock for @react-native-documents/picker — jest moduleNameMapper 映射到此。
 *
 * API 依据 v10.1.7 真实类型（lib/typescript/*.d.ts）：
 *  - pick() 返回 NonEmptyArray<DocumentPickerResponse>，用户取消时 reject OPERATION_CANCELED
 *  - 无 copyTo 选项；Android content:// 需 keepLocalCopy 转本地文件（返回 localUri）
 *
 * 默认模拟"选中一个 11 字节的 hello.txt 并成功拷入缓存"；测试内可 mockResolvedValueOnce 覆盖。
 */
module.exports = {
  __esModule: true,
  pick: jest.fn().mockResolvedValue([
    {
      uri: "content://mock/hello.txt",
      name: "hello.txt",
      error: null,
      type: "text/plain",
      nativeType: "text/plain",
      size: 11,
      isVirtual: false,
      convertibleToMimeTypes: null,
      hasRequestedType: true,
    },
  ]),
  keepLocalCopy: jest.fn().mockResolvedValue([
    {
      status: "success",
      sourceUri: "content://mock/hello.txt",
      localUri: "file:///mock/cache/hello.txt",
    },
  ]),
  types: {
    allFiles: "*/*",
    images: "image/*",
    pdf: "application/pdf",
    plainText: "text/plain",
  },
  errorCodes: {
    OPERATION_CANCELED: "OPERATION_CANCELED",
    IN_PROGRESS: "ASYNC_OP_IN_PROGRESS",
    UNABLE_TO_OPEN_FILE_TYPE: "UNABLE_TO_OPEN_FILE_TYPE",
  },
  isErrorWithCode: (e) => !!e && typeof e.code === "string",
}
