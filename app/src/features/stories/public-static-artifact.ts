import { z } from "zod";

export function isPublicStaticShellDirectory(path: string): boolean {
  return !path.includes("..") && ["stories", "404", "_not-found", "_next"].some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** Shared by the shell builder and publisher; it permits no application source or private routes. */
export function isPublicStaticShellPath(path: string): boolean {
  if (path.includes("..") || path.length > 1024) return false;
  return path === ".nojekyll"
    || /^(?:index|404)\.(?:html|txt)$/u.test(path)
    || /^(?:stories|_not-found)\/(?:index\.html|[^/]+\.txt)$/u.test(path)
    || path === "404/index.html"
    || /^__next\.[^/]+\.txt$/u.test(path)
    || /^_next\/static\/[a-zA-Z0-9_./-]+\.(?:js|css|woff2?)$/u.test(path);
}

export const PublicStaticShellBuildSchema = z.object({
  schemaVersion: z.literal("public-static-shell-build-v1"),
  basePath: z.literal("/f1plus1"),
  nodeVersion: z.literal("v24.18.0"),
  files: z.array(z.object({
    path: z.string().refine(isPublicStaticShellPath),
    sha256: z.string().regex(/^[0-9a-f]{64}$/u),
    bytes: z.number().int().nonnegative().max(16 * 1024 * 1024)
  }).strict()).min(4).max(10_000)
}).strict().superRefine((value, context) => {
  const paths = new Set(value.files.map((file) => file.path));
  if (paths.size !== value.files.length) context.addIssue({ code: "custom", message: "duplicate shell file" });
  for (const required of ["index.html", "stories/index.html", "404.html", ".nojekyll"]) {
    if (!paths.has(required)) context.addIssue({ code: "custom", message: "required shell file absent" });
  }
});

export type PublicStaticShellBuild = z.infer<typeof PublicStaticShellBuildSchema>;
