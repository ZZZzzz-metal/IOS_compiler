class Vault {
public:
    int visible;
    int inspect() const { return 7; }
protected:
    int guarded;
private:
    int secret;
};
void probe() { Vault object; object./*<cc>*/ }
