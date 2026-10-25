#include <stdio.h>

int main(void) {
    for (int i = 0; i < 256; ++i) {
        printf("中文😀0123456789\n"); // @bp:output
    }
    return 7;
}
