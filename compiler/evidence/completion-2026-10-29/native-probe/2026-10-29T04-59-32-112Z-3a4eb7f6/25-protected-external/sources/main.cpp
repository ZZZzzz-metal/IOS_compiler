class Base { protected: int protectedValue; void protectedMethod(); public: int publicValue; };
class Derived : public Base {};
int main() { Derived value; value.; }
