import assert from "node:assert/strict";
import test from "node:test";

import { buildExchangeQuote, getCurrencyIncrement } from "../scripts/api/exchange-math.js";

const currencies = {
  cp: { type: "sheet", rate: 1, integer: true },
  gp: { type: "sheet", rate: 100, integer: true },
  usd: { type: "virtual", rate: 1, integer: false, precision: 2 },
  eur: { type: "virtual", rate: 1.1, integer: false, precision: 2 },
  chip: { type: "virtual", rate: 0.2, integer: false, precision: 1, increment: 0.2 },
};

test("uses each currency rate as value in the shared base unit", () => {
  const quote = buildExchangeQuote(currencies, {
    fromCurrencyId: "gp",
    toCurrencyId: "cp",
    amount: 2,
  });

  assert.equal(quote.success, true);
  assert.equal(quote.exchangeRate, 100);
  assert.equal(quote.toAmount, 200);
});

test("rounds target amounts down to avoid creating value", () => {
  const quote = buildExchangeQuote(currencies, {
    fromCurrencyId: "usd",
    toCurrencyId: "eur",
    amount: 10,
  });

  assert.equal(quote.success, true);
  assert.equal(quote.toAmount, 9.09);
  assert.ok(quote.roundingRemainderToAmount > 0);
  assert.ok(quote.remainderBaseValue > 0);
  assert.ok(quote.toAmount * quote.toRate <= quote.fromAmount * quote.fromRate);
});

test("applies a percentage fee before target quantization", () => {
  const quote = buildExchangeQuote(currencies, {
    fromCurrencyId: "gp",
    toCurrencyId: "cp",
    amount: 2,
    feePercent: 5,
  });

  assert.equal(quote.success, true);
  assert.equal(quote.grossToAmount, 200);
  assert.equal(quote.feeToAmount, 10);
  assert.equal(quote.feeBaseValue, 10);
  assert.equal(quote.toAmount, 190);
});

test("rejects source amounts that do not match the configured increment", () => {
  const whole = buildExchangeQuote(currencies, {
    fromCurrencyId: "gp",
    toCurrencyId: "cp",
    amount: 1.5,
  });
  const fixedIncrement = buildExchangeQuote(currencies, {
    fromCurrencyId: "chip",
    toCurrencyId: "usd",
    amount: 0.3,
  });

  assert.equal(whole.errorCode, "INVALID_AMOUNT_INCREMENT");
  assert.equal(fixedIncrement.errorCode, "INVALID_AMOUNT_INCREMENT");
  assert.equal(getCurrencyIncrement(currencies.chip), 0.2);
});

test("returns OUTPUT_TOO_SMALL instead of granting an invalid target fraction", () => {
  const quote = buildExchangeQuote(currencies, {
    fromCurrencyId: "cp",
    toCurrencyId: "gp",
    amount: 1,
  });

  assert.equal(quote.success, false);
  assert.equal(quote.errorCode, "OUTPUT_TOO_SMALL");
});

test("quotes across storage types without claiming the balances were committed", () => {
  const quote = buildExchangeQuote(currencies, {
    fromCurrencyId: "gp",
    toCurrencyId: "usd",
    amount: 1,
  });

  assert.equal(quote.success, true);
  assert.equal(quote.fromType, "sheet");
  assert.equal(quote.toType, "virtual");
  assert.equal(quote.toAmount, 100);
});

test("rejects increments that balance storage cannot represent", () => {
  const invalidInteger = buildExchangeQuote({
    bad: { type: "virtual", rate: 1, integer: true, increment: 0.2 },
    good: currencies.usd,
  }, {
    fromCurrencyId: "bad",
    toCurrencyId: "good",
    amount: 1,
  });
  const invalidPrecision = buildExchangeQuote({
    bad: { type: "virtual", rate: 1, integer: false, precision: 2, increment: 0.001 },
    good: currencies.usd,
  }, {
    fromCurrencyId: "bad",
    toCurrencyId: "good",
    amount: 1,
  });

  assert.equal(invalidInteger.errorCode, "INVALID_CURRENCY_INCREMENT");
  assert.equal(invalidPrecision.errorCode, "INVALID_CURRENCY_INCREMENT");
});

test("never rounds a genuinely lower value up to a whole target unit", () => {
  const quote = buildExchangeQuote({
    almost: { type: "virtual", rate: 0.99999999995, integer: true },
    whole: { type: "virtual", rate: 1, integer: true },
  }, {
    fromCurrencyId: "almost",
    toCurrencyId: "whole",
    amount: 1,
  });

  assert.equal(quote.success, false);
  assert.equal(quote.errorCode, "OUTPUT_TOO_SMALL");
});

test("canonicalizes machine-noise input but rejects material fractional whole currency", () => {
  const machineNoise = buildExchangeQuote(currencies, {
    fromCurrencyId: "gp",
    toCurrencyId: "cp",
    amount: 1 + Number.EPSILON,
  });
  const materialFraction = buildExchangeQuote(currencies, {
    fromCurrencyId: "gp",
    toCurrencyId: "cp",
    amount: 1.0000000005,
  });

  assert.equal(machineNoise.success, true);
  assert.equal(machineNoise.fromAmount, 1);
  assert.equal(materialFraction.errorCode, "INVALID_AMOUNT_INCREMENT");
});

test("rejects numeric overflow instead of returning non-finite quote fields", () => {
  const quote = buildExchangeQuote({
    huge: { type: "virtual", rate: 1e308, integer: true },
    normal: { type: "virtual", rate: 1, integer: true },
  }, {
    fromCurrencyId: "huge",
    toCurrencyId: "normal",
    amount: 1e308,
  });

  assert.equal(quote.success, false);
  assert.equal(quote.errorCode, "NUMERIC_OVERFLOW");
});

test("keeps large but finite base values finite when rounding quote fields", () => {
  const quote = buildExchangeQuote({
    a: { type: "virtual", rate: Number.MAX_VALUE, integer: true },
    b: { type: "virtual", rate: Number.MAX_VALUE, integer: true },
  }, {
    fromCurrencyId: "a",
    toCurrencyId: "b",
    amount: 1,
  });

  assert.equal(quote.success, true);
  for (const key of ["grossBaseValue", "netBaseValue", "convertedBaseValue", "toAmount"]) {
    assert.equal(Number.isFinite(quote[key]), true, `${key} must be finite`);
  }
});

test("does not add units when quantizing large safe integers", () => {
  for (const amount of [1e15, 2e15]) {
    const quote = buildExchangeQuote({
      a: { type: "virtual", rate: 1, integer: true },
      b: { type: "virtual", rate: 1, integer: true },
    }, {
      fromCurrencyId: "a",
      toCurrencyId: "b",
      amount,
    });

    assert.equal(quote.success, true);
    assert.equal(quote.fromAmount, amount);
    assert.equal(quote.toAmount, amount);
    assert.equal(quote.convertedBaseValue <= quote.netBaseValue, true);
  }
});

test("does not lose an exactly integral target to floating-point division noise", () => {
  const exactRatio = buildExchangeQuote({
    a: { type: "virtual", rate: 0.3, integer: true },
    b: { type: "virtual", rate: 0.1, integer: true },
  }, {
    fromCurrencyId: "a",
    toCurrencyId: "b",
    amount: 1,
  });

  assert.equal(exactRatio.success, true);
  assert.equal(exactRatio.toAmount, 3);
  assert.equal(exactRatio.toAmount <= exactRatio.netToAmount
    + exactRatio.toIncrement * 1e-6, true);
});

test("preserves small finite base values instead of rounding them to zero", () => {
  const quote = buildExchangeQuote({
    a: { type: "virtual", rate: 1e-13, integer: true },
    b: { type: "virtual", rate: 2e-13, integer: true },
  }, {
    fromCurrencyId: "a",
    toCurrencyId: "b",
    amount: 3,
  });

  assert.equal(quote.success, true);
  assert.equal(quote.toAmount, 1);
  assert.ok(Math.abs(quote.grossBaseValue - 3e-13) < 1e-28);
  assert.ok(Math.abs(quote.convertedBaseValue - 2e-13) < 1e-28);
  assert.ok(quote.remainderBaseValue > 0);
});

test("rejects target amounts whose numeric spacing exceeds the currency increment", () => {
  const quote = buildExchangeQuote({
    source: { type: "virtual", rate: 313.77742468195873, integer: false, precision: 1, increment: 0.2 },
    target: { type: "virtual", rate: 0.00036188560119002387, integer: false, precision: 2, increment: 0.01 },
  }, {
    fromCurrencyId: "source",
    toCurrencyId: "target",
    amount: 193723331.8,
    feePercent: 46.651912846715426,
  });

  assert.equal(quote.success, false);
  assert.equal(quote.errorCode, "NUMERIC_OVERFLOW");
});

test("rejects source amounts whose spacing can shift a configured increment", () => {
  const quote = buildExchangeQuote({
    source: { type: "virtual", rate: 1, integer: false, precision: 2, increment: 0.05 },
    target: { type: "virtual", rate: 1, integer: false, precision: 2, increment: 0.05 },
  }, {
    fromCurrencyId: "source",
    toCurrencyId: "target",
    amount: 200000000000000.06,
  });

  assert.equal(quote.success, false);
  assert.equal(quote.errorCode, "NUMERIC_OVERFLOW");
});

test("corrects a division-rounded target that would create base-unit value", () => {
  const quote = buildExchangeQuote({
    a: { type: "virtual", rate: 0.05871178317572077, integer: true },
    b: { type: "virtual", rate: 0.00003312769142736961, integer: true },
  }, {
    fromCurrencyId: "a",
    toCurrencyId: "b",
    amount: 320838578479,
  });

  assert.equal(quote.success, true);
  assert.equal(quote.toAmount, 568618102935559);
  assert.equal(quote.convertedBaseValue <= quote.netBaseValue, true);
  assert.equal(quote.feeBaseValue >= 0, true);
  assert.equal(quote.remainderBaseValue >= 0, true);
});
