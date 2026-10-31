struct Outer { int outerOnly; };
struct Inner { int innerOnly; };
void probe() {
    Outer object;
    { Inner object; object./*<cc>*/ }
}
