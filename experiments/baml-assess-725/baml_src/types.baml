// Prototype-only copy of the current backend assess result contract.
class FinalTemperament {
  tightness int?
  rationale int?
  attribution int?
  caution int?
  extent int?
}

class ReviewConcerns {
  length "too_long" | "ok" | null
  style "too_stiff" | "ok" | null
  evidence "needs_caution" | "ok" | null
}

class ReviewDecision {
  reviewDecision "finalize" | "revise"
  reviewReason string
  revisionInstruction string?
  traceAlignment "aligned" | "misaligned" | null
  traceAlignmentReason string?
  finalTemperament FinalTemperament?
  moduleHints string[]?
  concerns ReviewConcerns?
  routingHints string[]?

  @@assert(revision_instruction_when_revising,
    {{ this.reviewDecision != "revise" or this.revisionInstruction|default("")|length > 0 }})
  @@assert(trace_reason_when_misaligned,
    {{ this.traceAlignment != "misaligned" or this.traceAlignmentReason|default("")|length > 0 }})
  @@assert(temperament_when_misaligned,
    {{ this.traceAlignment != "misaligned" or this.finalTemperament|default({})|length > 0 }})
}
