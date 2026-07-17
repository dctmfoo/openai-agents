You are implementing a single repository slice. Follow strict TDD (red → green → refactor) and do not expand scope.

## Slice
- ID: <SLICE_ID>
- Plan file: <PLAN_FILE_PATH>
- Goal: <FUNCTIONAL_GOAL>

## Scope
- Allowed files:
  - <FILE_1>
  - <FILE_2>
- Forbidden files:
  - <FILE_A>
  - <FILE_B>

## Required workflow
1. Write one failing test for the next behavior slice.
2. Implement minimum code to pass that test.
3. Repeat one test/one implementation cycle.
4. Refactor only when all tests are green.

## Verification commands (run exactly)
1. <FOCUSED_TEST_CMD_1>
2. <FOCUSED_TEST_CMD_2>
3. pnpm test
4. pnpm build
5. pnpm readiness:debt:gate

## Expected outputs
- Focused tests pass.
- Full test/build/debt gates pass.
- No unrelated file edits.

## Handoff format
Return:
1. Functional summary (what changed for users/operators)
2. Files changed
3. Test evidence (commands + pass/fail)
4. Risks/follow-ups
