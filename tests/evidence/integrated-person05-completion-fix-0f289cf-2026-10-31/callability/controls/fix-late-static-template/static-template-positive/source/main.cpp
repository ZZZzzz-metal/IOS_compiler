template<class LateType_a8ee505af129> struct LateBox_a8ee505af129 {
  template<class LateValueType_a8ee505af129> static int lateStaticRead_a8ee505af129(LateValueType_a8ee505af129 lateArgument_a8ee505af129) { (void)lateArgument_a8ee505af129; return 0; }
};

int main() {
  const LateBox_a8ee505af129<int> lateObject_a8ee505af129;
  return lateObject_a8ee505af129.lateStaticRead_a8ee505af129(1);
}
