#include <stdio.h>

int main(void) {
    fprintf(stderr, "before-controlled-trap\n");
    __builtin_trap(); // @bp:trap
    return 0;
}
