class Base { protected: int protectedValue; void protectedMethod(); public: int publicValue; };
class Derived : public Base { public: void run() { this->; } };
