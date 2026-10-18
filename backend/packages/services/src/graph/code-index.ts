/**
 * Lightweight code index: finds function definitions in JS/TS/Python sources
 * with line patterns (no parser) and links calls between the known functions.
 * Writes (File)-[:DEFINES]->(Function) and (Function)-[:CALLS]->(Function).
 *
 * Calls are matched by name only, so they are approximate: a call is linked
 * when the callee is defined in one of the indexed files.
 */

import { graphWrite } from "./falkordb";

export type SourceFile = { path: string; source: string };
export type FunctionDef = { name: string; file: string; signature: string; startLine: number; endLine: number };

const MAX_FUNCTIONS = 400;
const MAX_CALLS = 1500;
const MAX_SOURCE_CHARS = 400_000;

const NOT_A_NAME = new Set([
  "if", "for", "while", "switch", "catch", "function", "return", "typeof", "new", "await", "super",
  "constructor", "require", "import", "export", "else", "do", "try", "with", "yield", "delete", "void",
]);

const JS_PATTERNS = [
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/,
  /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>)/,
  /^\s*[A-Za-z_$][\w$.]*\.([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\b/,
  /^\s+(?:(?:public|private|protected|static|async|override|readonly)\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[^{]+)?\{\s*$/,
  /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/,
];
const PY_PATTERNS = [/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/];

function patternsFor(path: string) {
  if (/\.(?:[cm]?[jt]sx?)$/i.test(path)) return JS_PATTERNS;
  if (/\.py$/i.test(path)) return PY_PATTERNS;
  return null;
}

/** Definitions in source order; each spans to the line before the next definition. */
export function extractFunctions(path: string, source: string): FunctionDef[] {
  const patterns = patternsFor(path);
  if (!patterns || !source) return [];
  const lines = source.slice(0, MAX_SOURCE_CHARS).split(/\r?\n/);
  const defs: FunctionDef[] = [];
  const seen = new Set<string>();
  lines.forEach((line, index) => {
    for (const pattern of patterns) {
      const name = pattern.exec(line)?.[1];
      if (!name || NOT_A_NAME.has(name) || seen.has(name)) continue;
      seen.add(name);
      defs.push({ name, file: path, signature: line.trim().slice(0, 200), startLine: index + 1, endLine: lines.length });
      break;
    }
  });
  for (let i = 0; i < defs.length - 1; i++) defs[i]!.endLine = defs[i + 1]!.startLine - 1;
  return defs;
}

/** Blank out comments (keeping line breaks) so examples in docs are not read as calls. */
function stripComments(path: string, source: string) {
  if (/\.py$/i.test(path)) return source.replace(/#[^\n]*/g, "");
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

/**
 * Calls made inside each definition to other known functions. Plain calls (`name(`) may
 * resolve to another file when the name is unique; member calls (`x.name(`) only resolve
 * within the same file, because the receiver is unknown.
 */
export function findCalls(files: SourceFile[], defs: FunctionDef[]) {
  const byName = new Map<string, FunctionDef[]>();
  for (const d of defs) byName.set(d.name, [...(byName.get(d.name) ?? []), d]);

  const calls: Array<{ caller: FunctionDef; callee: FunctionDef }> = [];
  const seen = new Set<string>();
  for (const file of files) {
    const lines = stripComments(file.path, file.source.slice(0, MAX_SOURCE_CHARS)).split(/\r?\n/);
    for (const caller of defs.filter((d) => d.file === file.path)) {
      // Skip the definition line itself so a function is not its own caller.
      const body = lines.slice(caller.startLine, caller.endLine).join("\n");
      for (const match of body.matchAll(/(\.\s*)?([A-Za-z_$][\w$]*)\s*\(/g)) {
        const candidates = byName.get(match[2]!);
        if (!candidates) continue;
        const sameFile = candidates.find((c) => c.file === caller.file);
        const callee = sameFile ?? (!match[1] && candidates.length === 1 ? candidates[0]! : undefined);
        if (!callee || callee === caller) continue;
        const key = `${caller.file}#${caller.name}->${callee.file}#${callee.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        calls.push({ caller, callee });
        if (calls.length >= MAX_CALLS) return calls;
      }
    }
  }
  return calls;
}

export async function indexCodeFiles(workspaceId: string, files: SourceFile[]) {
  const usable = files.filter((f) => f.source && patternsFor(f.path));
  const defs = usable.flatMap((f) => extractFunctions(f.path, f.source)).slice(0, MAX_FUNCTIONS);
  const calls = findCalls(usable, defs);

  for (const d of defs) {
    await graphWrite(
      workspaceId,
      `MERGE (f:File {path: $file})
       MERGE (fn:Function {name: $name, file: $file})
       SET fn.signature = $signature, fn.line = $line
       MERGE (f)-[:DEFINES]->(fn)`,
      { file: d.file, name: d.name, signature: d.signature, line: d.startLine },
    );
  }
  for (const { caller, callee } of calls) {
    await graphWrite(
      workspaceId,
      `MATCH (a:Function {name: $an, file: $af}), (b:Function {name: $bn, file: $bf})
       MERGE (a)-[:CALLS]->(b)`,
      { an: caller.name, af: caller.file, bn: callee.name, bf: callee.file },
    );
  }
  return { files: usable.length, functions: defs.length, calls: calls.length };
}
