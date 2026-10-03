import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const source = ts.createSourceFile(
  "page.tsx",
  readFileSync(join(process.cwd(), "src/app/pos/fnb/page.tsx"), "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

function findNode(node: ts.Node, predicate: (node: ts.Node) => boolean): ts.Node | undefined {
  if (predicate(node)) return node;
  return ts.forEachChild(node, (child) => findNode(child, predicate));
}

describe("FnB payment submit lock", () => {
  it("releases the lock when sending to kitchen or checkout fails", () => {
    const declaration = findNode(
      source,
      (node) => ts.isVariableDeclaration(node) && node.name.getText(source) === "handlePayment",
    ) as ts.VariableDeclaration | undefined;
    expect(declaration).toBeDefined();

    const callback = findNode(declaration!, ts.isArrowFunction) as ts.ArrowFunction | undefined;
    expect(callback).toBeDefined();
    const paymentTry = callback!.body && ts.isBlock(callback!.body)
      ? callback!.body.statements.find(ts.isTryStatement)
      : undefined;
    expect(paymentTry?.finallyBlock).toBeDefined();

    const protectedCode = paymentTry!.tryBlock.getText(source);
    expect(protectedCode).toContain("await handleSendToKitchen()");
    expect(protectedCode).toContain("await offlineFnbPayment(");
    expect(protectedCode).toContain("checkoutStarted = true");
    expect(paymentTry!.catchClause!.getText(source)).toContain("Chưa gửi được món xuống bếp");
    expect(paymentTry!.finallyBlock!.getText(source)).toContain("fnbSubmitLockRef.current = false");
  });
});
