#include <cstdio>
int main() {
  int array[3] = {11,22,33};
  int other[3] = {44,55,66};
  short small[2] = {7,8};
  int *p = &array[2];
  int *q = &array[0];
  int *r = &other[0];
  short *s = &small[0];
  int *nullPointer = 0;
  void *opaque = p;
  int octal = 010;
  float f = 16777216.0f;
  std::printf("integer0=%lld\n", (long long)(0));
  std::printf("integer1=%lld\n", (long long)(010));
  std::printf("integer2=%lld\n", (long long)(00010));
  std::printf("integer3=%lld\n", (long long)(077));
  std::printf("integer4=%lld\n", (long long)(10));
  std::printf("integer5=%lld\n", (long long)(0x10));
  std::printf("integer6=%lld\n", (long long)(010 + 0x10));
  std::printf("integer7=%lld\n", (long long)(077 & 0xF));
  std::printf("integer8=%lld\n", (long long)(037777777777 + 1));
  std::printf("integer9=%lld\n", (long long)(020000000000 < -1));
  std::printf("integer10=%lld\n", (long long)(037777777777 == -1));
  std::printf("integer11=%lld\n", (long long)(2147483648 + 1));
  std::printf("integer12=%lld\n", (long long)(0xffffffff + 1));
  std::printf("integer13=%lld\n", (long long)(010 == 8));
  std::printf("integer14=%lld\n", (long long)(0X10));
  std::printf("integer15=%lld\n", (long long)(020000000000 + 020000000000));
  std::printf("integer16=%lld\n", (long long)(-1 < 020000000000));
  std::printf("target octal=%d difference=%d middle=%d null=%d plus=%.0f minus=%.0f\n", octal, int(p-q), *(p-1), int(nullPointer == 0), (+f)+1, (-f)-1);
  return 0;
}
