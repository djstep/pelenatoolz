import assert from "node:assert/strict";
import nodeModule from "node:module";
import { Prisma } from "@prisma/client";
import { before, describe, test } from "node:test";

// approve-casting.ts → assert-in-project.ts — серверный модуль ("server-only"):
// берём его с условием react-server, как в members-pages-access.test.ts.
type ResolveContext = { conditions: string[] };
type RegisterHooks = (hooks: {
  resolve: (
    specifier: string,
    context: ResolveContext,
    nextResolve: (specifier: string, context: ResolveContext) => unknown,
  ) => unknown;
}) => void;
(nodeModule as unknown as { registerHooks: RegisterHooks }).registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return nextResolve(specifier, {
        ...context,
        conditions: [...context.conditions, "react-server"],
      });
    }
    return nextResolve(specifier, context);
  },
});

let approve: typeof import("@/features/preproduction/lib/approve-casting");
before(async () => {
  approve = await import("@/features/preproduction/lib/approve-casting");
});

const person = {
  photoUrl: null,
  lastName: "Ставкин",
  firstName: "Иван",
  middleName: null,
  phone: null,
  email: null,
  agentName: null,
  agentPhone: null,
  agentEmail: null,
  physicalParams: {},
  skills: [],
  proposedRate: new Prisma.Decimal(5000),
  proposedTerms: "без ночных",
};

describe("утверждение кандидата кастинга", () => {
  test("в утверждение из браузера приходят только id — ставку прислать некуда", () => {
    // projectId, candidateId и фин. правка актёров из серверного контекста.
    assert.equal(approve.approveCastingCandidate.length, 3);
  });

  test("ставка и условия снимка — из записи кандидата в базе", () => {
    const snap = approve.buildCastSnapshotFromPerson(person);
    assert.equal(snap.shiftRate, 5000);
    assert.equal(snap.proposedRate, 5000);
    assert.equal(snap.proposedTerms, "без ночных");
  });
});
