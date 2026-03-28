include "root" {
  path = find_in_parent_folders()
}

terraform {
  source = "../../../modules/dynamodb"
}

inputs = {
  enable_ttl = true
  ttl_days   = 30
}
