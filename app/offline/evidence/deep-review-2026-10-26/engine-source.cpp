#include <cstdio>
int main() {
  int array[3] = {11,22,33};
  int *p = &array[2];
  int *q = &array[0];
  int octal = 010;
  float f = 16777216.0f;
  std::printf("target octal=%d difference=%d plus=%.0f minus=%.0f\n", octal, int(p-q), (+f)+1, (-f)-1);
  return 0;
}
