# Plan: sum()

Add `sum` as the default export of a new module, `src/sum.js`, as a `reduce` with an initial value of 0,
and re-export nothing from `src/math.js`. Tests go in `test/math.test.js` with the repo's runner (`node --test`),
importing `sum` from `../src/sum.js`.
