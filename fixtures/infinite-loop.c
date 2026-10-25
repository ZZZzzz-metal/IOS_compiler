int main(void) {
    volatile unsigned counter = 0;
    for (;;) {
        counter += 1; // @bp:loop
    }
}
