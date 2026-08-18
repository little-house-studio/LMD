export type SequenceArrow = 'call' | 'return';
export type SequenceFragmentType = 'alt' | 'opt' | 'loop' | 'par';

export interface SequenceParticipantIR {
  id: string;
  title: string;
}

export interface SequenceMessageIR {
  id: string;
  from: string;
  to: string;
  label: string;
  arrow: SequenceArrow;
  comment?: string;
}

export interface SequenceFragmentIR {
  id: string;
  type: SequenceFragmentType;
  title: string;
  steps: SequenceStepIR[];
}

export type SequenceStepIR =
  | { kind: 'message'; message: SequenceMessageIR }
  | { kind: 'fragment'; fragment: SequenceFragmentIR };

export interface SequenceSceneIR {
  id: string;
  title: string;
  participants: SequenceParticipantIR[];
  steps: SequenceStepIR[];
}

export interface SequenceIR {
  scenes: SequenceSceneIR[];
}

export function emptySequence(): SequenceIR {
  return { scenes: [] };
}

export function sequenceMessageCount(steps: SequenceStepIR[]): number {
  let count = 0;
  for (const step of steps) {
    if (step.kind === 'message') {
      count += 1;
    } else {
      count += sequenceMessageCount(step.fragment.steps);
    }
  }
  return count;
}
