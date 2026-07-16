export const COUNCIL_DECISION_OPTIONS = Object.freeze([
  Object.freeze({ value: "course-selection", label: "Course selection", labelKo: "과목 선택" }),
  Object.freeze({ value: "college-list", label: "College list", labelKo: "대학 목록" }),
  Object.freeze({ value: "ec-strategy", label: "Activity strategy", labelKo: "활동 전략" }),
  Object.freeze({ value: "narrative-arc", label: "Personal narrative", labelKo: "개인 서사" }),
  Object.freeze({ value: "other", label: "Other strategy", labelKo: "기타 전략" }),
]);

const VALID_TYPES = new Set(COUNCIL_DECISION_OPTIONS.map((option) => option.value));

export function resolveCouncilRequest(previous, question, decisionType, createRequestId) {
  const normalizedQuestion = String(question || "").trim();
  if (
    previous?.question === normalizedQuestion &&
    previous?.decisionType === decisionType &&
    previous?.requestId
  ) {
    return previous;
  }
  const requestId = typeof createRequestId === "function" ? createRequestId() : "";
  return { question: normalizedQuestion, decisionType, requestId };
}

export function isAmbiguousCouncilFailure(status) {
  return status == null || Number(status) >= 500;
}

export function reconcileCouncilFailureMessages(messages, clientTurnId, errorText) {
  const prior = Array.isArray(messages) ? messages : [];
  const retained = clientTurnId
    ? prior.filter((message) => message?.clientTurnId !== clientTurnId)
    : prior;
  return [
    ...retained,
    { role: "assistant", content: String(errorText || ""), transient: true },
  ];
}

export function createCouncilPayload(question, decisionType, requestId) {
  const text = String(question || "").trim();
  const id = String(requestId || "").trim();
  if (!text) throw new Error("A self-contained Council question is required.");
  if (text.length > 2000) throw new Error("Council questions are limited to 2,000 characters.");
  if (!VALID_TYPES.has(decisionType)) throw new Error("Choose a valid Council decision type.");
  if (!id || id.length > 128) throw new Error("A valid Council request ID is required.");
  return {
    question: text,
    request_id: id,
    explicit: true,
    auto: false,
    decision_type: decisionType,
  };
}

function decisionLabel(decisionType, locale = "en-US") {
  const option = COUNCIL_DECISION_OPTIONS.find((item) => item.value === decisionType);
  if (!option) return locale === "ko" ? "전략" : "Strategy";
  return locale === "ko" ? option.labelKo : option.label;
}

export function councilThreadTitle(decisionType, locale = "en-US") {
  const label = decisionLabel(decisionType, locale);
  return locale === "ko" ? `전략 위원회: ${label}` : `Strategy Council: ${label}`;
}

export function formatCouncilResult(body = {}, locale = "en-US") {
  if (body.crisisSafe) {
    const ko = locale === "ko";
    const parts = [String(body.answer || body.message || "").trim()].filter(Boolean);
    const resources = Array.isArray(body.actions) ? body.actions : [];
    if (resources.length) {
      parts.push(ko ? "**즉시 이용할 수 있는 지원**" : "**Immediate support**");
      for (const resource of resources) {
        if (resource && typeof resource === "object") {
          const name = String(resource.name || (ko ? "지원 기관" : "Support resource")).trim();
          const contact = String(resource.contact || resource.url || "").trim();
          const description = String(resource.description || "").trim();
          const details = [contact, description].filter(Boolean).join(" — ");
          parts.push(`- **${name}:** ${details}`.trim());
        } else if (resource) {
          parts.push(`- ${String(resource).trim()}`);
        }
      }
    }
    const limitations = Array.isArray(body.limitations)
      ? body.limitations.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    if (limitations.length) parts.push(...limitations.map((item) => `_${item}_`));
    return {
      text: parts.join("\n\n"),
      blocked: true,
      crisisSafe: true,
      threadTitle: ko ? "지원 안내" : "Support resources",
      council: false,
    };
  }

  const recommendation = String(body.recommendation || "").trim();
  if (!recommendation) throw new Error("The Strategy Council returned no recommendation.");

  const ko = locale === "ko";
  const parts = [
    ko ? "**전략 위원회 권고안**" : "**Strategy Council recommendation**",
    recommendation,
  ];
  const confidence = Number(body.confidence);
  if (Number.isFinite(confidence)) {
    const percent = Math.round(Math.max(0, Math.min(1, confidence)) * 100);
    parts.push(ko ? `**신뢰도:** ${percent}%` : `**Confidence:** ${percent}%`);
  }

  const dissents = Array.isArray(body.dissents) ? body.dissents : [];
  const visibleDissents = dissents
    .map((item) => (typeof item === "string"
      ? { role: ko ? "검토자" : "Reviewer", text: item.trim() }
      : {
        role: String(item?.from || item?.role || (ko ? "검토자" : "Reviewer")).trim(),
        text: String(item?.text || item?.recommendation || "").trim(),
      }))
    .filter((item) => item.text);
  if (visibleDissents.length) {
    parts.push(ko ? "**남아 있는 이견**" : "**Unresolved dissent**");
    for (const item of visibleDissents) parts.push(`- **${item.role}:** ${item.text}`);
  }

  const citations = [
    ...(Array.isArray(body.citations) ? body.citations : []),
    ...dissents.flatMap((item) => Array.isArray(item?.citations) ? item.citations : []),
  ];
  const validated = citations.filter((item) => item?.validated === true).length;
  parts.push(
    ko
      ? `**검증된 근거 참조:** ${validated}개`
      : `**Validated evidence references:** ${validated}`,
  );

  const actualCost = Number(body.usage?.actual_usd);
  if (Number.isFinite(actualCost)) {
    parts.push(ko ? `**이번 검토 비용:** $${actualCost.toFixed(4)}` : `**Review cost:** $${actualCost.toFixed(4)}`);
  }
  parts.push(
    ko
      ? "_AI가 생성한 자문입니다. 중요한 결정을 내리기 전에 근거를 독립적으로 확인하세요._"
      : "_AI-generated advisory analysis. Verify the evidence independently before making an important decision._",
  );

  return {
    text: parts.join("\n\n"),
    blocked: false,
    council: true,
    threadTitle: councilThreadTitle(body.decision_type, locale),
  };
}

export function councilErrorMessage(status, body = {}, locale = "en-US") {
  const ko = locale === "ko";
  const serverMessage = typeof body?.error === "string"
    ? body.error
    : (body?.error?.message || body?.message || "");
  if (status === 402) {
    return ko
      ? "이번 전략 위원회 검토는 남은 월간 AI 예산을 초과합니다. 일반 채팅을 사용하거나 다음 예산 주기를 기다려 주세요."
      : "This Strategy Council review does not fit your remaining monthly AI budget. Use ordinary chat or wait for the next budget cycle.";
  }
  if (status === 403) {
    return ko
      ? "전략 위원회를 사용하려면 필수 AI 및 데이터 전송 동의가 필요합니다."
      : "Required AI and data-transfer consent is needed before using Strategy Council.";
  }
  if (status === 409) {
    return ko
      ? "이 전략 위원회 요청은 이미 처리되었습니다. 채팅 기록에서 기존 결과를 확인하세요."
      : "This Strategy Council request was already processed. Check the conversation for its existing result.";
  }
  if (status === 503) {
    return ko
      ? "현재 이 기기에서 전략 위원회를 사용할 수 없습니다. 관리자 설정을 확인해 주세요."
      : "Strategy Council is unavailable on this device. Ask the administrator to check its configuration.";
  }
  return serverMessage || (ko ? "전략 위원회 요청에 실패했습니다." : "The Strategy Council request failed.");
}
