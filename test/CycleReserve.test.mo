import CycleReserve "../canisters/shared/CycleReserve";

assert CycleReserve.decide(0) == #lowCycles;
assert CycleReserve.decide(CycleReserve.minimumReserve - 1) == #lowCycles;
assert CycleReserve.decide(CycleReserve.minimumReserve) == #allowed;
assert CycleReserve.decide(CycleReserve.minimumReserve + 1) == #allowed;
