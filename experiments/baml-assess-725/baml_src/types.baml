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
}
