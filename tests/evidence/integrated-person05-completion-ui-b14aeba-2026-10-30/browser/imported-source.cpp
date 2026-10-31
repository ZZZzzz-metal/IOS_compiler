#include <cstdio>
struct PersonSaved { int savedValue; };
int main(){
 PersonSaved value{23};
 /* 中文😀 */
 std::printf("person05-final=%d\n",value.savedValue);
 return value.savedWRONG;
}
