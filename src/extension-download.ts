/**
 * 网页后台"插件下载"：登录后下载副驾驶插件的 zip（Amos 2026-10-30："咱们做的插件，让我可以在marketing后台下载"）。
 * zip 部署时由 scripts/build-ext-zip.mjs 从 extension/ 打包，和这次部署的服务是同一个提交，版本一定对得上。
 */
import { EXTENSION_VERSION, EXTENSION_ZIP_B64 } from './generated/extension';

export { EXTENSION_VERSION };

let bytes: Uint8Array<ArrayBuffer> | null = null;

export function extensionZip(): Response {
  if (!bytes) bytes = Uint8Array.from(atob(EXTENSION_ZIP_B64), (c) => c.charCodeAt(0));
  return new Response(bytes, {
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="marketing-copilot-${EXTENSION_VERSION}.zip"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
