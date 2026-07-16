const MAX_PRECISION = 12;

function failure(errorCode, error, details = {}) {
  return { success: false, errorCode, error, ...details };
}

function decimalPlaces(value) {
  const text = String(value).toLowerCase();
  if (text.includes("e-")) {
    const [coefficient, exponentText] = text.split("e-");
    const coefficientDecimals = coefficient.split(".")[1]?.length ?? 0;
    return Math.min(MAX_PRECISION, Number(exponentText) + coefficientDecimals);
  }
  return Math.min(MAX_PRECISION, text.split(".")[1]?.length ?? 0);
}

function roundDecimal(value, precision = MAX_PRECISION) {
  if (!Number.isFinite(value)) return value;
  const safePrecision = Math.max(0, Math.min(MAX_PRECISION, Number(precision) || 0));
  const factor = 10 ** safePrecision;
  if (Math.abs(value) > Number.MAX_SAFE_INTEGER / factor) return value;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function decimalFraction(value) {
  const match = String(value).toLowerCase().match(/^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/);
  if (!match) return null;
  const sign = match[1] === "-" ? -1n : 1n;
  const fractionDigits = match[3] ?? "";
  const exponent = Number(match[4] ?? 0);
  const digits = `${match[2]}${fractionDigits}`.replace(/^0+(?=\d)/, "");
  let numerator = sign * BigInt(digits || "0");
  const scale = fractionDigits.length - exponent;
  let denominator = 1n;
  if (scale > 0) denominator = 10n ** BigInt(scale);
  else if (scale < 0) numerator *= 10n ** BigInt(-scale);
  return { numerator, denominator };
}

function candidateCreatesBaseValue({ fromAmount, fromRate, toAmount, toRate, feePercent }) {
  const fromAmountFraction = decimalFraction(fromAmount);
  const fromRateFraction = decimalFraction(fromRate);
  const toAmountFraction = decimalFraction(toAmount);
  const toRateFraction = decimalFraction(toRate);
  const feeFraction = decimalFraction(feePercent);
  if (!fromAmountFraction || !fromRateFraction || !toAmountFraction
    || !toRateFraction || !feeFraction) return true;

  const netFactorNumerator = 100n * feeFraction.denominator - feeFraction.numerator;
  const netFactorDenominator = 100n * feeFraction.denominator;
  const sourceNumerator = fromAmountFraction.numerator
    * fromRateFraction.numerator
    * netFactorNumerator;
  const sourceDenominator = fromAmountFraction.denominator
    * fromRateFraction.denominator
    * netFactorDenominator;
  const targetNumerator = toAmountFraction.numerator * toRateFraction.numerator;
  const targetDenominator = toAmountFraction.denominator * toRateFraction.denominator;
  return targetNumerator * sourceDenominator > sourceNumerator * targetDenominator;
}

function currencyPrecision(def) {
  if (def?.integer !== false) return 0;
  const precision = Number(def?.precision);
  return Number.isInteger(precision) && precision >= 0 && precision <= 6 ? precision : 2;
}

function validateCurrencyIncrement(def, currencyId) {
  const configured = Number(def?.increment);
  if (def?.increment === undefined || def?.increment === null) return null;
  if (!Number.isFinite(configured) || configured <= 0) {
    return failure("INVALID_CURRENCY_INCREMENT", `Currency '${currencyId}' has an invalid increment.`);
  }
  if (def?.integer !== false && !Number.isInteger(configured)) {
    return failure("INVALID_CURRENCY_INCREMENT", `Integer currency '${currencyId}' requires a whole-number increment.`);
  }
  if (def?.integer === false) {
    const precision = currencyPrecision(def);
    if (roundDecimal(configured, precision) !== configured) {
      return failure(
        "INVALID_CURRENCY_INCREMENT",
        `Currency '${currencyId}' increment cannot be represented at precision ${precision}.`
      );
    }
  }
  return null;
}

export function getCurrencyIncrement(def) {
  const configured = Number(def?.increment);
  if (Number.isFinite(configured) && configured > 0) return configured;
  if (def?.integer !== false) return 1;
  return 1 / (10 ** currencyPrecision(def));
}

function quantizeDown(value, def) {
  if (!Number.isFinite(value)) return Number.NaN;
  const increment = getCurrencyIncrement(def);
  const precision = Math.max(currencyPrecision(def), decimalPlaces(increment));
  const scaled = value / increment;
  if (!Number.isFinite(scaled)) return Number.NaN;
  const nearest = Math.round(scaled);
  const tolerance = Math.min(1e-6, Number.EPSILON * Math.max(1, Math.abs(scaled)) * 8);
  const units = Math.abs(scaled - nearest) <= tolerance ? nearest : Math.floor(scaled);
  return roundDecimal(Math.max(0, units * increment), precision);
}

function amountMatchesIncrement(value, def) {
  const increment = getCurrencyIncrement(def);
  const scaled = value / increment;
  if (!Number.isFinite(scaled)) return false;
  const nearest = Math.round(scaled);
  const tolerance = Math.min(1e-12, Number.EPSILON * Math.max(1, Math.abs(scaled)) * 8);
  return Math.abs(scaled - nearest) <= tolerance;
}

function hasIncrementResolution(value, increment) {
  if (!Number.isFinite(value) || !Number.isFinite(increment) || increment <= 0) return false;
  const scaled = value / increment;
  if (!Number.isFinite(scaled) || Math.abs(scaled) > Number.MAX_SAFE_INTEGER) return false;
  const magnitude = Math.abs(value);
  if (magnitude === 0) return true;
  const spacing = 2 ** (Math.floor(Math.log2(magnitude)) - 52);
  return Number.isFinite(spacing) && spacing <= increment / 2;
}

function normalizeCurrencyMap(currencies) {
  if (!currencies || typeof currencies !== "object") return {};
  if (currencies.currencies && typeof currencies.currencies === "object") {
    return currencies.currencies;
  }
  return currencies;
}

/**
 * Build a deterministic exchange quote from currency definitions.
 * Rates express the value of one currency unit in the shared base unit.
 * The target amount is always rounded down to its valid increment so an
 * exchange can never create value through rounding.
 */
export function buildExchangeQuote(currenciesInput, request = {}) {
  const currencies = normalizeCurrencyMap(currenciesInput);
  const fromCurrencyId = String(request?.fromCurrencyId ?? "").trim();
  const toCurrencyId = String(request?.toCurrencyId ?? "").trim();

  if (!fromCurrencyId || !toCurrencyId) {
    return failure("CURRENCY_REQUIRED", "fromCurrencyId and toCurrencyId are required.");
  }
  if (fromCurrencyId === toCurrencyId) {
    return failure("SAME_CURRENCY", "Source and target currencies must differ.");
  }

  const from = currencies[fromCurrencyId];
  const to = currencies[toCurrencyId];
  if (!from) return failure("CURRENCY_NOT_FOUND", `Currency '${fromCurrencyId}' is not defined.`, { currencyId: fromCurrencyId });
  if (!to) return failure("CURRENCY_NOT_FOUND", `Currency '${toCurrencyId}' is not defined.`, { currencyId: toCurrencyId });

  const fromIncrementError = validateCurrencyIncrement(from, fromCurrencyId);
  if (fromIncrementError) return fromIncrementError;
  const toIncrementError = validateCurrencyIncrement(to, toCurrencyId);
  if (toIncrementError) return toIncrementError;

  const fromRate = Number(from.rate);
  const toRate = Number(to.rate);
  if (!Number.isFinite(fromRate) || fromRate <= 0 || !Number.isFinite(toRate) || toRate <= 0) {
    return failure("INVALID_RATE", "Both currencies must have a positive exchange rate.");
  }

  const requestedFromAmount = Number(request?.amount);
  if (!Number.isFinite(requestedFromAmount) || requestedFromAmount <= 0) {
    return failure("INVALID_AMOUNT", "amount must be a positive finite number.");
  }
  if (!hasIncrementResolution(requestedFromAmount, getCurrencyIncrement(from))) {
    return failure("NUMERIC_OVERFLOW", "amount is too large for the configured currency increment.");
  }
  if (!amountMatchesIncrement(requestedFromAmount, from)) {
    return failure(
      "INVALID_AMOUNT_INCREMENT",
      `amount must be a multiple of ${getCurrencyIncrement(from)} for '${fromCurrencyId}'.`,
      { increment: getCurrencyIncrement(from) }
    );
  }
  const fromAmount = quantizeDown(requestedFromAmount, from);
  if (!Number.isFinite(fromAmount) || fromAmount <= 0) {
    return failure("NUMERIC_OVERFLOW", "amount could not be represented safely.");
  }
  const sourceIncrement = getCurrencyIncrement(from);
  const sourceScaled = requestedFromAmount / sourceIncrement;
  const sourceToleranceAmount = sourceIncrement * Math.min(
    1e-12,
    Number.EPSILON * Math.max(1, Math.abs(sourceScaled)) * 8
  );
  if (Math.abs(fromAmount - requestedFromAmount) > sourceToleranceAmount) {
    return failure("NUMERIC_OVERFLOW", "amount could not be preserved at the configured currency increment.");
  }

  const feePercent = request?.feePercent === undefined ? 0 : Number(request.feePercent);
  if (!Number.isFinite(feePercent) || feePercent < 0 || feePercent >= 100) {
    return failure("INVALID_FEE_PERCENT", "feePercent must be at least 0 and less than 100.");
  }

  const exchangeRate = fromRate / toRate;
  const grossBaseValue = fromAmount * fromRate;
  const grossToAmount = grossBaseValue / toRate;
  const feeAmount = grossToAmount * (feePercent / 100);
  const netToAmount = grossToAmount - feeAmount;
  const feeBaseValue = grossBaseValue * (feePercent / 100);
  const normalizedNetBaseValue = grossBaseValue - feeBaseValue;
  if (![exchangeRate, grossBaseValue, grossToAmount, feeAmount, netToAmount, feeBaseValue, normalizedNetBaseValue]
    .every(Number.isFinite)
    || exchangeRate <= 0 || grossToAmount <= 0 || netToAmount <= 0 || normalizedNetBaseValue <= 0) {
    return failure("NUMERIC_OVERFLOW", "The exchange calculation exceeded the supported numeric range.");
  }
  if (!hasIncrementResolution(netToAmount, getCurrencyIncrement(to))) {
    return failure("NUMERIC_OVERFLOW", "The target amount is too large for the configured currency increment.");
  }

  let toAmount = quantizeDown(netToAmount, to);
  if (!Number.isFinite(toAmount)) {
    return failure("NUMERIC_OVERFLOW", "The target amount could not be represented safely.");
  }
  const toIncrement = getCurrencyIncrement(to);
  const netBaseValue = normalizedNetBaseValue;
  const targetIncrementBaseValue = toIncrement * toRate;
  if (!Number.isFinite(netBaseValue) || !Number.isFinite(targetIncrementBaseValue)) {
    return failure("NUMERIC_OVERFLOW", "The exchange calculation exceeded the supported numeric range.");
  }
  const targetScaled = netToAmount / toIncrement;
  const targetToleranceUnits = Math.min(
    1e-6,
    Number.EPSILON * Math.max(1, Math.abs(targetScaled)) * 8
  );
  const targetToleranceAmount = toIncrement * targetToleranceUnits;
  if (toAmount > netToAmount + targetToleranceAmount) {
    toAmount = quantizeDown(Math.max(0, toAmount - toIncrement), to);
    if (!Number.isFinite(toAmount) || toAmount > netToAmount + targetToleranceAmount) {
      return failure("NUMERIC_OVERFLOW", "The target amount could not be quantized without creating value.");
    }
  }

  let rawConvertedBaseValue = toAmount * toRate;
  if (!Number.isFinite(rawConvertedBaseValue)) {
    return failure("NUMERIC_OVERFLOW", "The exchange result exceeded the supported numeric range.");
  }
  // Division can round a mathematically fractional target up to an apparently
  // integral unit. Compare the candidate back in the shared base unit and, if
  // necessary, conservatively remove one target increment.
  if (candidateCreatesBaseValue({ fromAmount, fromRate, toAmount, toRate, feePercent })) {
    toAmount = quantizeDown(Math.max(0, toAmount - toIncrement), to);
    rawConvertedBaseValue = toAmount * toRate;
    if (!Number.isFinite(toAmount) || !Number.isFinite(rawConvertedBaseValue)
      || candidateCreatesBaseValue({ fromAmount, fromRate, toAmount, toRate, feePercent })) {
      return failure("NUMERIC_OVERFLOW", "The target amount could not be quantized without creating value.");
    }
  }

  if (!(toAmount > 0)) {
    return failure(
      "OUTPUT_TOO_SMALL",
      `amount is too small to produce the minimum increment of '${toCurrencyId}'.`,
      { increment: getCurrencyIncrement(to) }
    );
  }

  const roundingRemainder = Math.max(0, netToAmount - toAmount);
  const convertedBaseValue = Math.min(rawConvertedBaseValue, netBaseValue);
  const effectiveFeeBaseValue = grossBaseValue - netBaseValue;
  const remainderBaseValue = Math.max(0, netBaseValue - convertedBaseValue);
  if (![roundingRemainder, convertedBaseValue, effectiveFeeBaseValue, remainderBaseValue].every(Number.isFinite)) {
    return failure("NUMERIC_OVERFLOW", "The exchange result exceeded the supported numeric range.");
  }
  return {
    success: true,
    fromCurrencyId,
    toCurrencyId,
    fromType: from.type ?? "virtual",
    toType: to.type ?? "virtual",
    fromAmount,
    toAmount,
    fromRate,
    toRate,
    exchangeRate,
    feePercent,
    grossToAmount: roundDecimal(grossToAmount),
    feeToAmount: roundDecimal(feeAmount),
    netToAmount: roundDecimal(netToAmount),
    roundingRemainderToAmount: roundDecimal(roundingRemainder),
    grossBaseValue,
    feeBaseValue: effectiveFeeBaseValue,
    netBaseValue,
    convertedBaseValue,
    remainderBaseValue,
    fromIncrement: getCurrencyIncrement(from),
    toIncrement,
  };
}
