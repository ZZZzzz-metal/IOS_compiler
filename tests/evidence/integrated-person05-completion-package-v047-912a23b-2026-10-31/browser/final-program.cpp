#include <cstdio>
#include <string>
template<class T> struct FieldBox {
 template<class U> int v047Inspect(U) const { return 29; }
 template<class U> void v047Mutate(U) {}
 template<class U> static int v047Relay(U value) { return value; }
};
int pkgOrdinary() { return 3; }
__attribute__((deprecated("v047-deprecated"))) int pkgDeprecated() { return 4; }
__attribute__((unavailable("v047-unavailable"))) int pkgBlocked() { return 9; }
int pkgChoice(double) { return 5; }
int pkgChoice(int) = delete;
int main() {
 const std::string frozen = "cold";
 const FieldBox<int> box{};
 int stable = box.v047Inspect(0);
 int outcome = stable + pkgOrdinary() + pkgDeprecated() + pkgChoice(1.0);
 std::printf("person05-v047=%d\n", outcome);
 return outcome;
}
