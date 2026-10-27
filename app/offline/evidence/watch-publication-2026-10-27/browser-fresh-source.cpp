#include <cstdio> // V044-FRESH-OFFLINE-20261027
int main() {
  int array[3] = {11,22,33};
  int *p = &array[2];
  int *q = &array[0];
  int octal = 010;
  float f = 16777216.0f;
  std::printf("V044=%d:%d:%d:%.0f:%.0f\n", octal, int(p-q), *(p-1), (+f)+1, (-f)-1);
  return 0;
}
