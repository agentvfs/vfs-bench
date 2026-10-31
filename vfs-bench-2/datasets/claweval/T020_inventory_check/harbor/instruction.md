Check which items are running low and place restock orders.

## Tools

Each tool is a shell command; `<command> --help` says more.

- `inventory list-products [--category <string>]`: Get the product inventory list
- `inventory get-product --product-id <string>`: Get detailed inventory information for a single product
- `inventory create-order --product-id <string> --quantity <integer> [--supplier <string>]`: Create a restock order
