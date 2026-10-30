struct Payload { int actualLeaf; };
struct Envelope { Payload payload; int envelopeOnly; };
void probe() { Envelope object; object.payload./*<cc>*/ }
