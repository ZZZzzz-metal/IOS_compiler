template<class Type_a8ee505af129> struct Box_a8ee505af129 {
  int read_a8ee505af129() const { return 0; }
  void write_a8ee505af129(Type_a8ee505af129 argument_a8ee505af129) { (void)argument_a8ee505af129; }
  template<class OtherType_a8ee505af129> int inspect_a8ee505af129(const OtherType_a8ee505af129& argument_a8ee505af129) const { (void)argument_a8ee505af129; return 0; }
  template<class OtherType_a8ee505af129> void ingest_a8ee505af129(const OtherType_a8ee505af129& argument_a8ee505af129) { (void)argument_a8ee505af129; }
};
int main() {
  Box_a8ee505af129<int> object_a8ee505af129;
  object_a8ee505af129.write_a8ee505af129(1);
  object_a8ee505af129.ingest_a8ee505af129(1);
  return object_a8ee505af129.read_a8ee505af129() + object_a8ee505af129.inspect_a8ee505af129(0);
}
